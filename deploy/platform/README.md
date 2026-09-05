# Connect|API — Deployment Profiles

Todos os perfis pertencem ao **mesmo produto, repositório, VERSION e release flow do Connect|API**.
O Manager legado não participa de nenhum perfil.

## Configurar a stack

**Retaguarda emergencial:** comandos de scripts não compõem o deploy normal. Use somente o Compose e o `.env` no gerenciador da stack, conforme `OPERATIONS-CONTRACT.md`.

## Perfil `api`

Engine Node/TypeScript + PostgreSQL/Redis/RabbitMQ/MinIO. Sem frontend, Control Plane ou DOCs.

**Retaguarda emergencial:** comandos de scripts não compõem o deploy normal. Use somente o Compose e o `.env` no gerenciador da stack, conforme `OPERATIONS-CONTRACT.md`.

## Perfil `docs`

API-only + documentação oficial da mesma versão.

**Retaguarda emergencial:** comandos de scripts não compõem o deploy normal. Use somente o Compose e o `.env` no gerenciador da stack, conforme `OPERATIONS-CONTRACT.md`.

## Perfil `platform`

Produto completo: Engine, DOCs, Platform Control API, Vue frontend, workers, scheduler, banco de governança, backups, Log Agent, Prometheus/Grafana e gateway. ACME/CloudPanel permanecem opcionais pelo profile `cloudpanel`.

**Retaguarda emergencial:** comandos de scripts não compõem o deploy normal. Use somente o Compose e o `.env` no gerenciador da stack, conforme `OPERATIONS-CONTRACT.md`.

## Develop completo independente

Para o ambiente operacional `develop`, use a stack própria:

```text
deploy/platform-develop/
project = argws-connect-platform-develop
network = argws-connect-platform-develop-net
```

Ela não usa `deploy/develop` como base e sobe Engine + DOCs + Platform completa por padrão, sempre com imagens `:develop` da aplicação. Consulte `deploy/platform-develop/README.md`.

## Atualizar / status

```bash
./deploy/platform/update.sh platform
./deploy/platform/status.sh platform
```

## Build local

```bash
docker compose --env-file deploy/platform/.env \
  -f deploy/platform/compose.yaml \
  -f deploy/platform/compose.local-build.yaml \
  --profile platform up -d --build
```

## Lifecycle

- `develop` publica `:develop` para Engine e imagens Platform;
- `main` usa o `auto-version-release.yml` canônico;
- `VERSION` e `package.json` da raiz são a única fonte de versão;
- Platform API/Web/Gateway recebem exatamente a mesma SemVer do Connect|API;
- o RC34 não mantém versionamento nem workflow próprio.

## Contrato operacional vigente

No gerenciador de stacks, forneça o Compose deste deployment e o `.env`, preservando os volumes existentes. Credenciais de registry pertencem à configuração do gerenciador. O pooler gera seus próprios arquivos dentro do container; migrations, bootstrap e backup continuam sob responsabilidade dos serviços. Atualize as imagens homologadas pela ação de atualização da stack, sem aplicadores externos ou overlays obrigatórios. Consulte `OPERATIONS-CONTRACT.md` e `docs/guides/database-pooling.md`.

## SSL automático: procedimento canônico

Use o modelo de **um Reverse Proxy base + ACME/CloudPanel Agent por serviços**, descrito em [SSL e instâncias](../../docs/guides/platform-ssl-instances-corrective.md). Esta seção prevalece sobre exemplos históricos de setup manual/profile `cloudpanel`. Nas stacks completas, não execute scripts no VPS nem instale certificados manualmente. Preserve seu `.env` e os volumes ao atualizar a stack.
