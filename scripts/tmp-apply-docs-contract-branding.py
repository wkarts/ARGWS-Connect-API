from pathlib import Path

ROOT = Path('.')

# 1) OpenAPI / AsyncAPI generator
p = ROOT / 'docs/scripts/generate-openapi.mjs'
s = p.read_text()

old = """      description: [
        '![Connect|API DOCs](/openapi/branding/docs/connect-api-docs-light.png)', '',
        'Documentação gerada a partir das rotas Express atuais do projeto. O contrato nativo continua sendo a interface principal da aplicação e pode coexistir com a camada Meta Compatible `/graph`.', '',
        '### Autenticação', 'A API nativa usa o header `apikey`. Instâncias podem utilizar a chave global configurada ou o token próprio, conforme os guards da aplicação.', '',
        '### Providers', '- `WHATSAPP-BUSINESS`', '- `WHATSAPP-BAILEYS`', '- `CONNECT`', '',
        '### Atualização automática', 'Este documento é materializado por `docs/scripts/generate-openapi.mjs`. Alterações de rotas fazem o `Docs Integrity` falhar até o contrato ser regenerado e versionado.',
      ].join('\\n'),"""
new = """      description: [
        '![Connect|API REST](/openapi/branding/docs/connect-api-rest-light.png)', '',
        'API nativa do Connect|API. Pode coexistir com a fachada Meta Compatible `/graph`.', '',
        '### Autenticação', 'A API nativa usa o header `apikey`. Instâncias podem utilizar a chave global configurada ou o token próprio, conforme os guards da aplicação.', '',
        '### Providers', '- `WHATSAPP-BUSINESS`', '- `WHATSAPP-BAILEYS`', '- `CONNECT`', '',
        '### Atualização automática', 'Este documento é materializado por `docs/scripts/generate-openapi.mjs`. Alterações de rotas fazem o `Docs Integrity` falhar até o contrato ser regenerado e versionado.',
      ].join('\\n'),"""
if old not in s:
    raise SystemExit('REST description anchor not found')
s = s.replace(old, new, 1)

old = """      title: 'Connect|API — Meta Compatible /graph', version, summary: 'Fachada HTTP/Webhook compatível com o contrato Meta WhatsApp Cloud.',
      description: 'A camada `/graph` é uma fachada de protocolo sobre o mesmo núcleo do Connect|API. Não cria provider paralelo, não cria `wamid` virtual e retorna o ID real do provider. A autenticação usa `Authorization: Bearer <INSTANCE_TOKEN>`. Toda instância compatível e com identidade telefônica estável é Graph-addressable por padrão.',"""
new = """      title: 'Connect|API — Meta Compatible /graph', version, summary: 'Fachada HTTP/Webhook compatível com o contrato Meta WhatsApp Cloud.',
      description: [
        '![Connect|API Meta](/openapi/branding/docs/connect-api-meta-light.png)', '',
        'Fachada Meta Compatible sobre o mesmo núcleo do Connect|API, sem provider paralelo e sem `wamid` artificial.', '',
        'A autenticação usa `Authorization: Bearer <INSTANCE_TOKEN>`. Toda instância compatível com identidade telefônica estável é Graph-addressable por padrão.',
      ].join('\\n'),"""
if old not in s:
    raise SystemExit('META description anchor not found')
s = s.replace(old, new, 1)

old = """    info: { title: 'Connect|API — Eventos', version, description: 'Catálogo dos eventos definidos em `Events`, publicáveis por Webhook, WebSocket, RabbitMQ, NATS, SQS, Pusher ou Kafka conforme configuração e suporte.' },"""
new = """    info: {
      title: 'Connect|API — Eventos',
      version,
      description: [
        '![Connect|API Events](/openapi/branding/docs/connect-api-events-light.png)', '',
        'Eventos do Connect|API publicáveis por Webhook, WebSocket, RabbitMQ, NATS, SQS, Pusher ou Kafka conforme configuração e suporte.',
      ].join('\\n'),
    },"""
if old not in s:
    raise SystemExit('EVENT description anchor not found')
s = s.replace(old, new, 1)
p.write_text(s)

# 2) PWA shell: same theme drives Scalar + all contract logos; hide only redundant rendered headings.
p = ROOT / 'docs/pwa/index.html'
s = p.read_text()
old = """      function syncDocumentLogos() {
        const target = currentTheme === 'dark' ? 'connect-api-docs-dark.png' : 'connect-api-docs-light.png'
        const opposite = currentTheme === 'dark' ? 'connect-api-docs-light.png' : 'connect-api-docs-dark.png'

        document.querySelectorAll('#app img').forEach((image) => {
          const source = image.getAttribute('src') || ''
          if (!source.includes(opposite)) return
          image.setAttribute('src', source.replace(opposite, target))
        })
      }

      function observeScalar() {
        if (scalarObserver) scalarObserver.disconnect()
        scalarObserver = new MutationObserver(() => {
          syncScalarTheme()
          syncDocumentLogos()
        })
"""
new = """      const documentLogoPairs = [
        ['connect-api-docs-light.png', 'connect-api-docs-dark.png'],
        ['connect-api-rest-light.png', 'connect-api-rest-dark.png'],
        ['connect-api-meta-light.png', 'connect-api-meta-dark.png'],
        ['connect-api-events-light.png', 'connect-api-events-dark.png'],
      ]

      const redundantDocumentTitles = new Set([
        'Connect|API — REST API',
        'Connect|API — Meta Compatible /graph',
        'Connect|API — Eventos',
      ])

      function syncDocumentLogos() {
        document.querySelectorAll('#app img').forEach((image) => {
          const source = image.getAttribute('src') || ''
          for (const [lightName, darkName] of documentLogoPairs) {
            const target = currentTheme === 'dark' ? darkName : lightName
            const opposite = currentTheme === 'dark' ? lightName : darkName
            if (!source.includes(opposite)) continue
            image.setAttribute('src', source.replace(opposite, target))
            break
          }
        })
      }

      function hideRedundantDocumentTitles() {
        document.querySelectorAll('#app h1, #app h2, #app h3, #app [role=\"heading\"]').forEach((heading) => {
          const text = (heading.textContent || '').trim()
          if (!redundantDocumentTitles.has(text)) return
          heading.hidden = true
          heading.setAttribute('aria-hidden', 'true')
        })
      }

      function syncDocumentPresentation() {
        syncScalarTheme()
        syncDocumentLogos()
        hideRedundantDocumentTitles()
      }

      function observeScalar() {
        if (scalarObserver) scalarObserver.disconnect()
        scalarObserver = new MutationObserver(() => {
          syncDocumentPresentation()
        })
"""
if old not in s:
    raise SystemExit('PWA sync anchor not found')
s = s.replace(old, new, 1)
old = """        syncScalarTheme()
        syncDocumentLogos()

        if (persist) {"""
new = """        syncDocumentPresentation()

        if (persist) {"""
if old not in s:
    raise SystemExit('PWA setTheme anchor not found')
s = s.replace(old, new, 1)
p.write_text(s)

# 3) Docs CI contracts: require the six binary assets and verify each document uses the right logo.
p = ROOT / '.github/workflows/docs-integrity.yml'
s = p.read_text()
old = """          grep -q 'connect-api-docs-light.png' docs/pwa/index.html
          grep -q 'favicon.svg' docs/pwa/index.html
"""
new = """          grep -q 'connect-api-docs-light.png' docs/pwa/index.html
          grep -q 'connect-api-rest-light.png' docs/pwa/index.html
          grep -q 'connect-api-meta-light.png' docs/pwa/index.html
          grep -q 'connect-api-events-light.png' docs/pwa/index.html
          grep -q 'favicon.svg' docs/pwa/index.html
          for asset in \\
            public/branding/connect-api/docs/connect-api-rest-light.png \\
            public/branding/connect-api/docs/connect-api-rest-dark.png \\
            public/branding/connect-api/docs/connect-api-meta-light.png \\
            public/branding/connect-api/docs/connect-api-meta-dark.png \\
            public/branding/connect-api/docs/connect-api-events-light.png \\
            public/branding/connect-api/docs/connect-api-events-dark.png; do
            test -s \"$asset\"
            file \"$asset\" | grep -q 'PNG image data'
          done
"""
if old not in s:
    raise SystemExit('CI source asset anchor not found')
s = s.replace(old, new, 1)

old = """          curl -fsS http://127.0.0.1:38082/openapi/branding/docs/connect-api-docs-dark.svg -o /tmp/connect-api-docs-dark.svg
          test -s /tmp/connect-api-docs-light.png
"""
new = """          curl -fsS http://127.0.0.1:38082/openapi/branding/docs/connect-api-docs-dark.svg -o /tmp/connect-api-docs-dark.svg
          for contract in rest meta events; do
            curl -fsS \"http://127.0.0.1:38082/openapi/branding/docs/connect-api-${contract}-light.png\" -o \"/tmp/connect-api-${contract}-light.png\"
            curl -fsS \"http://127.0.0.1:38082/openapi/branding/docs/connect-api-${contract}-dark.png\" -o \"/tmp/connect-api-${contract}-dark.png\"
            test -s \"/tmp/connect-api-${contract}-light.png\"
            test -s \"/tmp/connect-api-${contract}-dark.png\"
          done
          test -s /tmp/connect-api-docs-light.png
"""
if old not in s:
    raise SystemExit('CI runtime asset anchor not found')
s = s.replace(old, new, 1)

old = """          node -e \"for (const f of ['/tmp/connect-api.openapi.json','/tmp/meta-compatible.openapi.json','/tmp/connect-api-events.asyncapi.json']) JSON.parse(require('fs').readFileSync(f,'utf8'))\"
          node -e \"const s=JSON.parse(require('fs').readFileSync('/tmp/connect-api.openapi.json','utf8')); if(s.components?.securitySchemes?.apiKey?.name!=='apikey') throw new Error('native auth header must be apikey');\"
"""
new = """          node -e \"for (const f of ['/tmp/connect-api.openapi.json','/tmp/meta-compatible.openapi.json','/tmp/connect-api-events.asyncapi.json']) JSON.parse(require('fs').readFileSync(f,'utf8'))\"
          node - <<'NODE'
          const fs = require('fs')
          const native = JSON.parse(fs.readFileSync('/tmp/connect-api.openapi.json','utf8'))
          const graph = JSON.parse(fs.readFileSync('/tmp/meta-compatible.openapi.json','utf8'))
          const events = JSON.parse(fs.readFileSync('/tmp/connect-api-events.asyncapi.json','utf8'))
          if (native.components?.securitySchemes?.apiKey?.name !== 'apikey') throw new Error('native auth header must be apikey')
          if (!native.info?.description?.includes('connect-api-rest-light.png')) throw new Error('REST branding ausente')
          if (!graph.info?.description?.includes('connect-api-meta-light.png')) throw new Error('Meta branding ausente')
          if (!events.info?.description?.includes('connect-api-events-light.png')) throw new Error('Events branding ausente')
          NODE
"""
if old not in s:
    raise SystemExit('CI contract anchor not found')
s = s.replace(old, new, 1)
p.write_text(s)
