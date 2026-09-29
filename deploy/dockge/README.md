# Deploy — Dockge

Envie para o Dockge somente `compose.yaml` e o `.env` da stack. Os dados ficam em
`./volumes/*` ao lado desses arquivos. Configure `COMPOSE_PROFILES` no `.env`
quando quiser ativar services opcionais.

O service interno `volume-init` prepara apenas binds vazios de Kafka/ZooKeeper;
não existe etapa de script no host.
