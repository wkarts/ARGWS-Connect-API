# ARGWS Platform Template

Template white-label reutilizável derivado da fundação genérica do Control Plane.

Ele será empacotado automaticamente em `ARGWS-Platform-Template.zip` em todo build da Fase 2. O objetivo é permitir iniciar outros produtos ARGWS sem copiar regras específicas do Connect/WhatsApp.

## Contrato

Inclui fundação para:

- Control Plane;
- Partner / Tenant / Installation;
- provisionamento;
- domínios;
- nodes;
- PostgreSQL, Redis, RabbitMQ e NATS;
- Prometheus, Grafana e Log Agent;
- CloudPanel/Cloudflare adapters;
- deployment com `./volumes/...`;
- observabilidade e auditoria.

Não inclui lógica específica de WhatsApp, ConnectAI, sessões ou mensagens.
