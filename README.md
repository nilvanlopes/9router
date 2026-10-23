# 9router na LAN

Dashboard: `http://9router.localnetwork`. Endpoint dos clientes:
`http://9router.localnetwork/v1`, com uma API key criada no dashboard.

Build próprio da [tag v0.5.104](https://github.com/decolua/9router/tree/v0.5.104),
versão mais recente do código e também HEAD de `master` na consulta de 20/10/2026.
O endpoint `releases/latest` do GitHub ainda aponta para v0.5.35 e não deve ser
usado isoladamente para escolher a versão atual deste projeto. O painel compara
a versão instalada com a publicada no npm.
Código fixado no commit `87a74e1bda3677193c6f71a7e2100c90311f0689`, arquivo
verificado por SHA-256, Node 22 Alpine fixado por digest e dependências fixadas
no `package-lock.json`. `package.json` preserva o manifesto upstream com um
override de DOMPurify para 3.4.17, corrigindo os alertas da versão transitiva
do Monaco. O Dockerfile verifica o manifesto contra o código fixado e executa
`npm ci`.

O build também aplica o ajuste local em `patches/` para permitir controlar
o túnel pelo dashboard autenticado em `.localnetwork`.

## Preparação e execução

A rede externa `traefik-local` deve existir e permitir containers Compose
(`attachable=true`). O ambiente já usa uma rede overlay com essas propriedades.
Se necessário, na raiz do repositório: `make setup-traefik-local-network`.

Gere o `.env` local uma única vez, sem imprimir segredos nem sobrescrever um
arquivo existente:

```bash
cd /home/pyu/docker/9router
python3 - <<'PY'
import os
import secrets

keys = ('JWT_SECRET', 'INITIAL_PASSWORD', 'API_KEY_SECRET', 'MACHINE_ID_SALT')
fd = os.open('.env', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as f:
    for key in keys:
        f.write(f'{key}={secrets.token_hex(32)}\n')
PY
docker compose config --quiet
docker compose up -d --build --wait
```

Ou, depois de criar o `.env`, na raiz: `make deploy-9router`.
Consulte `INITIAL_PASSWORD` no `.env` local para entrar e configure os provedores
e a API key dos clientes. Guarde o `.env` com o backup dos dados: trocar os
segredos pode invalidar sessões e chaves existentes.

A rota está em `../traefik/infra/traefik/dynamic/9router.yml`. O provider de
arquivos do Traefik acompanha esse diretório, sem labels de descoberta.
Ela usa o entrypoint `traefik_local`, `traefik-local-lan-only@file` e
`crowdsec@file`, encaminhando a `http://9router:20128`. A regra DNS curinga
`*.localnetwork` do AdGuard já cobre o hostname. O host Linux acessa o IP LAN
do Traefik pela interface IPvlan `local-lan` e usa o AdGuard para resolver
`.localnetwork`; veja [a configuração do host](../traefik/acesso-localnetwork-host/README.md).

## Ligar e desligar o túnel pelo dashboard

Abra `http://9router.localnetwork`, faça login e use o botão de ativar ou
desativar em **Tunnel**. O túnel fornece uma URL pública para usar a API fora
da sua rede. Outro computador da LAN já pode usar o endereço `.localnetwork`.

Na versão original, esses botões são limitados a localhost ou ao token
administrativo da CLI. Como o acesso aqui passa pelo Traefik, a versão
original responde `Local only: CLI token required` mesmo com o dashboard
logado.

O ajuste em `patches/` permite as operações de ativar e desativar o túnel
Cloudflare quando o pedido vem do endereço configurado em
`TUNNEL_DASHBOARD_ORIGIN` e tem uma sessão válida do dashboard. No Compose,
esse endereço é `http://9router.localnetwork`. Ele precisa corresponder ao
endereço usado no navegador, incluindo `http` ou `https` e a porta, se houver.

Essa permissão exige login mesmo que a opção de exigir login do dashboard
seja desativada. Acesso pelo endereço público do túnel e as outras operações
administrativas continuam seguindo as restrições originais. A API key usada
pelas CLIs serve para chamar os modelos; ela não autoriza esses botões.

Os arquivos são aplicados durante o build. Se mudar a versão upstream, o
aplicador verifica os trechos que altera e interrompe o build caso seja
necessário revisar o ajuste. Para aplicar a configuração nesta instalação:

```bash
cd /home/pyu/docker/9router
docker compose up -d --build --wait
```

Depois, recarregue o painel. A configuração permite usar os botões; a criação
do túnel ainda depende de o contêiner conseguir baixar e executar o
`cloudflared` e alcançar a Cloudflare.

## Segurança e persistência

Veja [SECURITY.md](./SECURITY.md) para os alertas conhecidos das dependências.
O hardening não torna a aplicação livre de vulnerabilidades.

- Runtime com `/bin/sh`, sem npm, Yarn, compilador ou Python; o build conserva
  essas ferramentas apenas nos estágios intermediários.
- UID/GID 1000, código pertencente a root, filesystem somente leitura,
  capabilities removidas e `no-new-privileges`.
- Volume nomeado `ninerouter_data` em `/app/data`, criado com dono 1000:1000 e
  modo 0700. O caminho alternativo `~/.9router` aponta ao mesmo volume.
  Não há inicialização como root nem `chown` a cada partida. Um volume importado
  precisa manter esse UID/GID.
- Somente dados e os tmpfs de `/tmp` e do cache Next.js são graváveis. Limites
  de memória, CPU, processos e rotação de logs no Compose.
- Nenhuma porta publicada, nenhum Docker socket montado. Somente a rede
  `traefik-local`, com saída para os provedores de IA. Outros containers dessa
  rede também podem conectar ao backend; a allowlist é aplicada no Traefik.
- HTTP interno: `AUTH_COOKIE_SECURE=false`. Senhas, cookies e chamadas não têm
  criptografia no trajeto pela LAN. Se a rota migrar para HTTPS, ative essa opção.
- Logs detalhados de requisições e observabilidade desativados por padrão.
  Provedores e tokens continuam persistidos no volume; proteja seus backups.

Na v0.5.104, `REQUIRE_API_KEY` aparece no exemplo upstream, mas não é consumida
pelo runtime. O guard exige API key para requisições remotas às rotas de IA;
as chamadas pelo Traefik são tratadas como remotas. A opção `requireApiKey` também
existe nas configurações do dashboard. O login do dashboard fica habilitado
por padrão. Operações upstream limitadas a localhost, como ferramentas MITM,
não são liberadas pelo proxy.

Este serviço usa **Docker Compose local**, conectado à rede compartilhada do
Swarm. `docker stack deploy` ignora o build e não aplica todas as opções de
segurança deste Compose. Não use esse comando para este arquivo.

## Operação

```bash
cd /home/pyu/docker/9router
docker compose ps
docker compose logs -f --tail=100
docker compose exec 9router /bin/sh
docker compose restart
docker compose down
```

`down` preserva o volume. `down -v` apaga credenciais e banco de dados.
Faça backup consistente com o serviço parado; guarde o volume inteiro e o `.env`.
Atualizações devem ser feitas pelo rebuild da imagem, pois a aplicação não
pode alterar o próprio código em runtime.

Para atualizar a versão, revise a release, o commit, o SHA-256 do arquivo,
o manifesto e os arquivos necessários ao runtime. Regenere o lockfile usando
a mesma base Node, revise a auditoria e teste o login, a rejeição de chamadas
sem chave e a persistência. O build Next.js baixa a fonte Inter do Google e
precisa de acesso à rede nessa etapa. Novas versões da base exigem atualizar
o digest e repetir o build.

O botão de atualização do dashboard mostra instruções voltadas à instalação
por npm. Nesta instalação, atualize a tag/commit fixados e reconstrua a imagem;
instalar pacotes dentro do container não atualiza os arquivos deste projeto.
Antes de uma atualização com dados existentes, salve uma cópia consistente do
volume e do `.env`. Backups locais ficam em `backups/`, ignorado pelo Git.

## Validação local

Build e testes da v0.5.104 realizados em Linux amd64: imagem com aproximadamente
433 MB (tamanho local informado pelo Docker, sem compressão de transporte).
O runtime usa somente o Next.js incluído pelo tracing standalone, sem copiar
uma segunda instalação completa do framework.

Um container temporário, sem portas publicadas e com as restrições do Compose,
validou o módulo nativo SQLite, o login, o acesso autenticado às configurações,
a criação de API key e a listagem de modelos com uma chave válida. Chamadas
remotas sem chave ou com chave inválida retornaram 401. Também foram verificados
UID 1000, capabilities zeradas, `no-new-privileges`, bloqueio de escrita no código,
tmpfs graváveis, os arquivos estáticos do painel e persistência do volume após
recriar o container. `/api/version` retornou `currentVersion: "0.5.104"` e
`hasUpdate: false`.
O container e o volume de teste foram removidos. Chamadas a provedores reais
dependem das credenciais configuradas depois do deploy.
