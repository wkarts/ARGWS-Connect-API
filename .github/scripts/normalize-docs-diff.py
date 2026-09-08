from pathlib import Path
import subprocess


def git_show(path: str) -> str:
    return subprocess.check_output(['git', 'show', f'origin/develop:{path}'], text=True)


generator_path = Path('docs/scripts/generate-openapi.mjs')
generator = git_show(str(generator_path))
pairs = [
    ('![Connect|API REST](/openapi/branding/docs/connect-api-rest-light.png)', '![Connect|API REST](openapi/branding/docs/connect-api-rest-light.png)'),
    ('![Connect|API Meta](/openapi/branding/docs/connect-api-meta-light.png)', '![Connect|API Meta](openapi/branding/docs/connect-api-meta-light.png)'),
    ('![Connect|API Events](/openapi/branding/docs/connect-api-events-light.png)', '![Connect|API Events](openapi/branding/docs/connect-api-events-light.png)'),
]
for old, new in pairs:
    if generator.count(old) != 1:
        raise SystemExit(f'Expected one generated branding path: {old}')
    generator = generator.replace(old, new, 1)
generator_path.write_text(generator)


topology_path = Path('docs/DOCS-DEPLOYMENT-TOPOLOGY.md')
topology = git_show(str(topology_path)).rstrip() + '''

### Assets e branding no modo interno

Os documentos OpenAPI/AsyncAPI usam caminhos relativos para os assets de branding. Assim, a mesma imagem DOCs resolve logos e demais recursos tanto na raiz de um deployment standalone quanto sob `/manager/docs/` no acesso interno same-origin, sem depender de um hostname externo de documentação.
'''
topology_path.write_text(topology)
