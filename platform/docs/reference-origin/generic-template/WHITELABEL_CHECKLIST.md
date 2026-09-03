# CHECKLIST — WHITELABEL E RENOMEAÇÃO COMPLETA

## Produto
- [ ] Nome longo
- [ ] Nome curto
- [ ] slug técnico
- [ ] descrição/tagline
- [ ] vendor/legal name
- [ ] repositório GitHub
- [ ] package/project names

## Web/PWA
- [ ] `<title>`
- [ ] meta description
- [ ] favicon
- [ ] Apple Touch Icon
- [ ] manifest `name`/`short_name`
- [ ] PWA 192/512/maskable
- [ ] theme/background colors
- [ ] logo light/dark
- [ ] login
- [ ] header/sidebar/footer
- [ ] Control Plane
- [ ] páginas públicas

## Backend
- [ ] FastAPI title/description
- [ ] APP_NAME e SMTP_FROM_NAME
- [ ] service names de logs
- [ ] OpenAPI
- [ ] mensagens/CLI/bootstrap
- [ ] demo tenant

## Rede
- [ ] domínio público
- [ ] control
- [ ] admin
- [ ] api
- [ ] demo
- [ ] wildcard/tenant root
- [ ] trusted hosts
- [ ] CORS
- [ ] Cloudflare target
- [ ] ACME/SSL

## Persistência
- [ ] platform DB
- [ ] tenant DB prefix
- [ ] tenant DB user prefix
- [ ] S3 prefix
- [ ] backup namespace
- [ ] rclone remotes

## Containers/CI
- [ ] COMPOSE_PROJECT_NAME
- [ ] imagens GHCR
- [ ] nomes de services/containers
- [ ] workflows
- [ ] release artifact names
- [ ] Prometheus job
- [ ] Grafana labels
- [ ] systemd services/timers

## Domínio
- [ ] remover menus financeiros
- [ ] remover rotas financeiras
- [ ] remover providers bancários
- [ ] remover migrations exclusivas do domínio antigo
- [ ] remover fixtures/seeds antigos
- [ ] remover testes antigos que não fazem sentido
- [ ] criar módulos reais do novo produto
- [ ] criar permissões reais

## Validação
- [ ] grep de marca antiga = zero no runtime
- [ ] backend tests
- [ ] frontend tests
- [ ] frontend build
- [ ] docker compose config
- [ ] migrations platform
- [ ] migrations tenant
- [ ] teste A/B de isolamento
- [ ] auditoria de logs/segredos
- [ ] regenerar MANIFEST.sha256
