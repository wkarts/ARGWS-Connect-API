# Validação do deployment GHCR

Revisão preparada para o ARGWS Connect API 1.0.0.

## Escopo

- imagens de runtime referenciadas somente por `ghcr.io/wkarts/argws-connect-*`;
- Dockerfiles da API e Manager usando bases espelhadas no GHCR;
- workflow de sincronização das imagens de infraestrutura para o GHCR;
- workflow de publicação multi-arquitetura da API e do Manager;
- deployment completo para CloudPanel;
- stack pronta para Dockge;
- `.env.example` completo para aplicação + infraestrutura;
- assets visuais de runtime permanecem dentro das imagens da API/Manager.

## Compatibilidade preservada

Nesta revisão:

- `package.json` não foi alterado;
- `package-lock.json` não foi alterado;
- `src/` não foi alterado;
- `prisma/` não foi alterado;
- nenhuma dependência foi adicionada, removida ou atualizada;
- nenhuma migration foi alterada.

## Validações estáticas

- YAML: válido;
- JSON: válido;
- scripts Bash do CloudPanel: sintaxe válida;
- variáveis lidas via `process.env` no código: todas contempladas nos envs de deployment;
- referências de imagem em YAML/Dockerfile de runtime fora do GHCR: zero.

## Observação sobre bootstrap do GHCR

O workflow `ghcr-sync-infrastructure.yml` acessa os registries de origem exclusivamente dentro do GitHub Actions para copiar as imagens ao GHCR. Os hosts de produção/homologação consomem somente as cópias publicadas no GHCR.

## Release automation

- Canonical initial version: `1.0.0`
- Every successful merge to `main`: automatic SemVer release
- Default increment: `patch`
- Optional PR labels: `version:patch`, `version:minor`, `version:major`
- GitHub Release created only after successful validation and GHCR image publication
