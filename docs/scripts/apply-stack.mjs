import fs from 'node:fs';

function updatePackage() {
  const file = 'package.json';
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.scripts ||= {};
  pkg.scripts['docs:generate'] = 'node docs/scripts/generate-openapi.mjs';
  pkg.scripts['docs:check'] = 'node docs/scripts/generate-openapi.mjs --check';
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}

function updateCompose() {
  const file = 'docker-compose.yaml';
  let yaml = fs.readFileSync(file, 'utf8');
  if (yaml.includes('\n  docs:\n')) return;

  const service = `
  docs:
    image: \${ARGWS_CONNECT_DOCS_IMAGE:-scalarapi/api-reference:latest}
    pull_policy: always
    container_name: argws_connect_docs
    restart: unless-stopped
    environment:
      API_REFERENCE_CONFIG: >-
        {"sources":[{"url":"/openapi/connect-api.openapi.json","title":"Connect|API REST API","slug":"rest","default":true},{"url":"/openapi/meta-compatible.openapi.json","title":"Connect|API Meta Compatible","slug":"meta-compatible"},{"url":"/openapi/connect-api-events.asyncapi.json","title":"Connect|API Events","slug":"events"}],"theme":"none","layout":"modern","darkMode":false,"showOperationId":true,"modelsSectionLabel":"Schemas","operationTitleSource":"summary","documentDownloadType":"both","showDeveloperTools":"localhost","agent":{"disabled":true},"favicon":"/openapi/branding/core/connect-api-app-icon-gradient.png","customCss":"html{--scalar-color-accent:#2563eb;--scalar-background-1:#ffffff;--scalar-background-2:#f7f9fc;--scalar-background-3:#eef3f9;--scalar-color-1:#0f172a;--scalar-color-2:#475569;--scalar-color-3:#64748b;--scalar-border-color:#dbe4ef}.dark-mode{--scalar-background-1:#0f172a;--scalar-background-2:#111827;--scalar-background-3:#172033;--scalar-color-1:#f8fafc;--scalar-color-2:#cbd5e1;--scalar-color-3:#94a3b8;--scalar-border-color:#263249}"}
    ports:
      - "\${ARGWS_CONNECT_BIND_ADDRESS:-127.0.0.1}:\${ARGWS_CONNECT_DOCS_HOST_PORT:-38082}:8080"
    volumes:
      - ./docs/openapi/connect-api.openapi.json:/docs/connect-api.openapi.json:ro
      - ./docs/openapi/meta-compatible.openapi.json:/docs/meta-compatible.openapi.json:ro
      - ./docs/asyncapi/connect-api-events.asyncapi.json:/docs/connect-api-events.asyncapi.json:ro
      - ./public/branding/connect-api/core:/docs/branding/core:ro
      - ./public/branding/connect-api/docs:/docs/branding/docs:ro
    networks:
      - argws-connect-net
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 10
      start_period: 20s
    logging: *default-logging

`;

  const marker = '  postgres:\n';
  if (!yaml.includes(marker)) throw new Error('docker-compose.yaml: postgres service marker not found');
  yaml = yaml.replace(marker, service + marker);
  fs.writeFileSync(file, yaml);
}

function updateEnv() {
  const file = '.env.example';
  let env = fs.readFileSync(file, 'utf8');
  if (env.includes('ARGWS_CONNECT_DOCS_IMAGE=')) return;

  const marker = 'ARGWS_CONNECT_API_HOST_PORT=38080\n';
  const portBlock = `${marker}ARGWS_CONNECT_DOCS_HOST_PORT=38082\n`;
  if (!env.includes(marker)) throw new Error('.env.example: API host port marker not found');
  env = env.replace(marker, portBlock);

  const imageMarker = 'ARGWS_CONNECT_API_IMAGE=ghcr.io/wkarts/argws-connect-api:latest\n';
  const imageBlock = `${imageMarker}ARGWS_CONNECT_DOCS_IMAGE=scalarapi/api-reference:latest\n`;
  if (!env.includes(imageMarker)) throw new Error('.env.example: API image marker not found');
  env = env.replace(imageMarker, imageBlock);

  fs.writeFileSync(file, env);
}

function updateAgents() {
  const file = 'AGENTS.md';
  let text = fs.readFileSync(file, 'utf8');
  if (text.includes('## Connect|API Documentation Governance')) return;

  text += `

## Connect|API Documentation Governance

Documentation is part of the Definition of Done. Before completing any public or integration-facing change, read \`docs/DOCUMENTATION-CONTRACT.md\`.

Mandatory workflow for public API, DTO, event, provider capability, environment, deployment, media, Meta Compatible or operational changes:

1. Implement the real behavior first.
2. Update semantic guides/examples when needed.
3. Run \`npm run docs:generate\` whenever routes or the central Events catalog change.
4. Run \`npm run docs:check\` before declaring the task complete.
5. Keep native REST, Meta Compatible and Events contracts truthful to the code.
6. Never invent endpoints, fields, provider capabilities or response semantics only to make documentation look complete.

If a change truly has no documentation impact, the PR must state:

\`DOCS IMPACT: NONE\`

with a short objective reason.

The official self-hosted documentation service is \`docs\`, powered by Scalar API Reference and the versioned OpenAPI/AsyncAPI files under \`docs/\`.
`;
  fs.writeFileSync(file, text);
}

updatePackage();
updateCompose();
updateEnv();
updateAgents();
console.log('[docs] Scalar stack integration applied.');
