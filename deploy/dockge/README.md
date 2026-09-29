# Deploy — Dockge

Envie para o Dockge somente `compose.yaml` e o `.env` da stack. Os dados ficam em
`./volumes/*` ao lado desses arquivos. Configure `COMPOSE_PROFILES` no `.env`
quando quiser ativar services opcionais.

Os services internos `volume-init` e `mysql-volume-init` fazem a preparação
necessária dentro do próprio Compose e permanecem saudáveis após concluir. Não
existe etapa de script no host, nem arquivo auxiliar para copiar ao Dockge.
