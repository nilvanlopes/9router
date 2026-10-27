#!/usr/bin/env python3
"""Build and deploy the local, single-node Swarm service without printing secrets."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
SERVICE = 'ninerouter_9router'

def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)

def output(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()

if not (ROOT / '.env').is_file():
    sys.exit('Crie 9router/.env conforme README.md.')
# Reject a second writer to the SQLite volume, including the legacy Compose process.
for cid in output('docker', 'ps', '-q', '--filter', 'volume=ninerouter_data').split():
    labels = json.loads(output('docker', 'inspect', '-f', '{{json .Config.Labels}}', cid)) or {}
    if labels.get('com.docker.swarm.service.name') != SERVICE:
        sys.exit('Há um container fora do serviço Swarm usando ninerouter_data; pare-o antes do deploy.')
node = output('docker', 'info', '--format', '{{.Swarm.NodeID}}')
if not node:
    sys.exit('Este host precisa participar do Swarm.')
# The existing volume is local: pin the service to its actual node, never another manager.
run('docker', 'volume', 'inspect', 'ninerouter_data', stdout=subprocess.DEVNULL)
env = dict(os.environ, NINEROUTER_NODE_ID=node)
# Compose parses .env quoting/interpolation; never source secrets as shell code.
config = json.loads(output('docker', 'compose', '--env-file', '.env', 'config', '--format', 'json', env=env, stderr=subprocess.PIPE))
env.update(config['services']['9router']['environment'])
# Validation output contains secrets; keep it out of the terminal.
run('docker', 'stack', 'config', '-c', 'docker-compose.yml', env=env, stdout=subprocess.DEVNULL)
if '--skip-build' not in sys.argv[1:]:
    run('docker', 'build', '--target', 'runtime', '-t', 'local/9router:0.5.104', '.')
# Stack schema lacks pids limits. Deploy at zero replicas, then set both fields in
# one service update; no application process starts without its PID cgroup limit.
run('docker', 'stack', 'deploy', '--detach=true', '--resolve-image', 'never', '-c', 'docker-compose.yml', 'ninerouter', env=env)
for _ in range(60):
    # Wait for any old running task before scheduling the sole SQLite writer.
    live = output('docker', 'ps', '-q', '--filter', 'label=com.docker.swarm.service.name=' + SERVICE)
    if not live:
        break
    time.sleep(1)
else:
    sys.exit('A tarefa anterior não parou; serviço mantido sem nova réplica.')
run('docker', 'service', 'update', '--detach=true', '--limit-pids', '256', '--replicas', '1', SERVICE)
for _ in range(150):
    ids = output('docker', 'ps', '-q', '--filter', 'label=com.docker.swarm.service.name=' + SERVICE).split()
    if len(ids) == 1:
        status = output('docker', 'inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{end}}', ids[0])
        if status == 'healthy':
            print(SERVICE + ': 1 réplica saudável no Swarm.')
            break
    time.sleep(2)
else:
    sys.exit('O serviço não ficou saudável; consulte docker service ps --no-trunc ' + SERVICE)
