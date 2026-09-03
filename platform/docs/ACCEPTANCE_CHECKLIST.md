# Acceptance Checklist — Connect|API Platform

- [ ] `Connect|API Platform` aparece corretamente em UI e docs;
- [ ] nenhum identificador técnico contém `|`;
- [ ] favicon, PWA, logo light/dark e OpenGraph resolvem;
- [ ] Control Plane e Tenant Plane permanecem separados;
- [ ] criação de dois tenants comprova isolamento de banco/storage;
- [ ] `ENABLE_REFERENCE_FINANCIAL_DOMAIN=false` por padrão;
- [ ] `connect-api`, `connect-web` e `connect-gateway` são os nomes canônicos;
- [ ] `docker compose config`/parse YAML válido;
- [ ] frontend compila/typecheck;
- [ ] backend importa/compila e testes executam com dependências instaladas;
- [ ] logs não expõem secrets;
- [ ] webhooks e jobs carregam tenant context;
- [ ] PBX/VOIP/DOCs usam somente os assets oficiais fornecidos.
