from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def replace(file, old, new):
    target = ROOT / file
    text = target.read_text()
    if text.count(old) != 1:
        raise RuntimeError('Expected one exact integration point in ' + file + ': ' + repr(old[:80]))
    target.write_text(text.replace(old, new, 1))

replace('scripts/sync-operations-deployments.py', '    return outputs\n',
'''    # Keep the additive Find Hub template contract during operations regeneration.
    from runpy import run_path
    findhub = run_path(str(root / 'scripts/sync-findhub-deployments.py'))
    outputs.update(findhub['generate'](root, overrides=outputs))
    return outputs
''')

file = 'docs/scripts/generate-openapi.mjs'
replace(file, "import { videoCallOperations, videoCallSchemas } from './video-call-schemas.mjs';", "import { videoCallOperations, videoCallSchemas } from './video-call-schemas.mjs';\nimport { findHubOperations, findHubSchemas, findHubEventMessages } from './findhub-schemas.mjs';")
replace(file, '  ...videoCallOperations,', '  ...videoCallOperations,\n  ...findHubOperations,')
replace(file, '        ...videoCallSchemas,', '        ...videoCallSchemas,\n        ...findHubSchemas,')
replace(file, "    tags: [\n      { name: 'Core'", "    tags: [\n      { name: 'Google Find Hub', description: 'Contas Google, autenticação por CredentialProvider, dispositivos, localização, tracking e Traccar. Consulte também o documento dedicado Google Find Hub no seletor do Scalar.' },\n      { name: 'Core'")
replace(file, 'function graphSpec(version) {', '''function findHubSpec(native, version) {
  return {
    ...native,
    info: {
      title: 'Connect|API — Google Find Hub', version,
      summary: 'Implantação, autenticação, dispositivos, localização e Traccar.',
      description: fs.readFileSync(path.join(ROOT, 'docs', 'guides', 'google-find-hub.md'), 'utf8'),
    },
    tags: native.tags.filter((tag) => tag.name === 'Google Find Hub'),
    paths: Object.fromEntries(Object.entries(native.paths).filter(([apiPath]) => apiPath.startsWith('/findhub/'))),
  };
}

function graphSpec(version) {''')
replace(file, "  const channels = {};\n  for (const event of events)", "  const channels = {};\n  const findHubMessages = {};\n  for (const event of events)")
replace(file, '  return {\n    asyncapi:', '''  for (const [event, definition] of Object.entries(findHubEventMessages)) {
    if (!channels[event]) continue;
    const messageName = event.replace(/[^A-Za-z0-9]+/g, '_');
    channels[event].description = definition.description;
    channels[event].subscribe.message = { $ref: `#/components/messages/${messageName}` };
    findHubMessages[messageName] = {
      name: messageName, title: event,
      payload: { type: 'object', additionalProperties: true, properties: {
        event: { type: 'string' }, instance: {}, data: definition.data,
      } },
    };
  }
  return {
    asyncapi:''')
replace(file, 'components: { messages: { ConnectEvent:', 'components: { messages: { ...findHubMessages, ConnectEvent:')
replace(file, 'const graph = graphSpec(pkg.version);', 'const graph = graphSpec(pkg.version);\nconst findhub = findHubSpec(native, pkg.version);')
replace(file, "writeOrCheck(path.join(OUTPUT_DIR, 'connect-api.openapi.json'), stableJson(native));", "writeOrCheck(path.join(OUTPUT_DIR, 'connect-api.openapi.json'), stableJson(native));\nwriteOrCheck(path.join(OUTPUT_DIR, 'findhub.openapi.json'), stableJson(findhub));")
replace('docs/Dockerfile', 'COPY docs/openapi/connect-api.openapi.json /docs/connect-api.openapi.json', 'COPY docs/openapi/connect-api.openapi.json /docs/connect-api.openapi.json\nCOPY docs/openapi/findhub.openapi.json /docs/findhub.openapi.json')
replace('docs/pwa/index.html', '        if (configuredSources.length > 0) {', '''        if (
          configuredSources.some((source) => String(source.url || '').includes('connect-api.openapi.json')) &&
          !configuredSources.some((source) => String(source.url || '').includes('findhub.openapi.json'))
        ) {
          configuredSources.push({ url: 'openapi/findhub.openapi.json', title: 'Connect|API Google Find Hub', slug: 'findhub' })
        }

        if (configuredSources.length > 0) {''')
replace('docs/pwa/sw.js', "'connect-api-docs-pwa-v2'", "'connect-api-docs-pwa-v3-findhub'")
file = ROOT / 'package.json'
text = file.read_text()
old = '"test:findhub": "tsx ./test/findhub-protocol.contract.test.ts"'
new = '"test:findhub": "tsx ./test/findhub-protocol.contract.test.ts && tsx ./test/findhub-vault.test.ts && node --test test/findhub-deployment.contract.test.cjs && python3 test/findhub-env.test.py"'
assert text.count(old) == 1
file.write_text(text.replace(old, new))
for path in ('docs/README.md', 'deploy/README.md'):
    target = ROOT / path
    target.write_text(target.read_text().rstrip() + '\n\n## Google Find Hub\n\n' +
      ('[Guia completo de implantação e autenticação](guides/google-find-hub.md)' if path.startswith('docs/') else '[Guia completo de implantação e autenticação](../docs/guides/google-find-hub.md)') +
      '. A chave local é preparada por `prepare-findhub-env.py`, sem rotacionar segredos existentes. O Scalar inclui o documento `openapi/findhub.openapi.json`.\n')
subprocess.run(['python3', 'scripts/sync-findhub-deployments.py'], cwd=ROOT, check=True)
subprocess.run(['python3', 'scripts/sync-operations-deployments.py'], cwd=ROOT, check=True)
subprocess.run(['python3', 'scripts/sync-operations-deployments.py', '--check'], cwd=ROOT, check=True)
subprocess.run(['python3', 'scripts/sync-findhub-deployments.py', '--check'], cwd=ROOT, check=True)
subprocess.run(['node', 'docs/scripts/generate-openapi.mjs'], cwd=ROOT, check=True)
