# ARGWS Connect Control Plane — Phase 2

Control Plane administrativo e multitenant da ARGWS Connect Platform.

O banco operacional do ARGWS Connect API permanece independente e **não recebe `tenantId`** nesta fase. Partner, Tenant, Installation, Domain, Node, Plan e Provisioning pertencem ao banco do Control Plane.

## Planos

- **Control Plane**: implementação específica do ARGWS Connect.
- **ARGWS Platform Template**: versão white-label reutilizável, exportada em cada build da Fase 2.
- **Data Plane**: ARGWS Connect API existente, sem refatoração abrupta.

## Topologia inicial

```text
Internet / Cloudflare
        |
        v
Control Plane Gateway (1 porta)
  |-- Web
  |-- API
  |-- /grafana
  |
  +-- PostgreSQL
  +-- Redis
  +-- RabbitMQ (jobs duráveis)
  +-- NATS JetStream (eventos/realtime)
  +-- Prometheus
  +-- Grafana
  +-- Log Agent

Control Plane
  |
  +-- Partner
       +-- Tenant
            +-- Installation
                 +-- Domain
                 +-- Node/Server
                 +-- ARGWS Connect API
```

Kafka/Zookeeper ficam reservados para streaming/replay/analytics quando houver consumidor real.
