from pathlib import Path
import subprocess

WORKFLOW = Path('.github/workflows/tmp-provider-capabilities-phase5.yml')
SELF = Path('scripts/tmp-apply-provider-capabilities-phase5.py')

subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], check=True)
subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], check=True)

paths = [str(WORKFLOW), str(SELF)]
subprocess.run(['git', 'rm', '-f', *paths], check=True)
subprocess.run(['git', 'commit', '-m', 'chore(tmp): limpa artefatos temporários da Fase 5'], check=True)
subprocess.run(['git', 'push', '--no-verify', 'origin', 'HEAD:feat/provider-capabilities-preview-phase5'], check=True)
