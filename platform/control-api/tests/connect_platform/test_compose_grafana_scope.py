"""All Compose variants are inventoried; fixes apply wherever Grafana exists."""
from pathlib import Path
import json
import subprocess
import tempfile
import yaml

ROOT = Path(__file__).resolve().parents[4]
EXPECTED = {'deploy/platform/compose.yaml', 'deploy/platform-develop/compose.yaml', 'deploy/platform-production/compose.yaml'}


def test_all_compose_variants_have_consistent_grafana_and_preserve_poolers():
    found = set()
    checked = 0
    for path in ROOT.rglob('*'):
        if path.suffix not in {'.yaml', '.yml'} or 'compose' not in path.name or any(v in path.parts for v in ('node_modules', '.git')):
            continue
        config = yaml.safe_load(path.read_text()) or {}
        if not isinstance(config, dict) or not config.get('services'): continue
        checked += 1
        for service in config['services'].values():
            if 'grafana' not in str(service.get('image', '')): continue
            found.add(path.relative_to(ROOT).as_posix())
            command = service['command'][0]
            assert '/var/lib/grafana/dashboards' in command.splitlines()[0]
            assert 'disableDeletion: true' in command and 'allowUiUpdates: true' in command
            assert 'if [ ! -e /var/lib/grafana/dashboards/connect-platform-runtime.json ]' in command
            assert len([n for n in config['services'] if 'pgbouncer' in n]) == 2
            assert config['x-platform-env']['GRAFANA_LOCAL_ADMIN_ENABLED'] == '${GRAFANA_LOCAL_ADMIN_ENABLED:-true}'
    assert checked >= 20
    assert found == EXPECTED


def test_grafana_command_generates_missing_dashboard_without_overwriting_existing_files():
    commands = []
    for path in sorted(EXPECTED):
        services = yaml.safe_load((ROOT/path).read_text())['services']
        service = next(v for v in services.values() if 'grafana' in str(v.get('image', '')))
        command = service['command'][0]
        commands.append(command)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runtime = command.replace('/tmp/grafana-provisioning', str(root/'config')).replace('/var/lib/grafana', str(root/'data')).replace('exec /run.sh', 'true')
            subprocess.run(['/bin/sh', '-ec', runtime], check=True)
            dashboard = root/'data/dashboards/connect-platform-runtime.json'
            assert json.loads(dashboard.read_text())['uid'] == 'connect-platform-runtime'
            dashboard.write_text('{"customized":true}')
            (dashboard.parent/'user-dashboard.json').write_text('{"uid":"user-owned"}')
            subprocess.run(['/bin/sh', '-ec', runtime], check=True)
            assert json.loads(dashboard.read_text()) == {'customized': True}
            assert (dashboard.parent/'user-dashboard.json').exists()
    assert len(set(commands)) == 1
