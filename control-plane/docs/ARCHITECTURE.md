# Arquitetura — Control Plane

## Fronteira

O Control Plane administra a plataforma; o ARGWS Connect API executa comunicação. A camada administrativa não é adicionada às tabelas operacionais do Connect.

## Entidades de controle

```text
Partner
  -> Tenant
      -> Installation
          -> Domain
          -> Deployment
          -> Node
          -> Runtime Channel
          -> Secret References
```

### Partner
Pode administrar tenants delegados conforme permissões concedidas pelo Control Plane.

### Tenant
Unidade comercial/administrativa. Não é sinônimo de instância WhatsApp.

### Installation
Representa uma instalação/runtime do produto para um tenant e aponta para versão, node, domínio, database, Redis namespace, storage namespace e estado de provisionamento.

### Instance
Continua pertencendo ao ARGWS Connect API/Data Plane. Um tenant pode possuir várias instâncias WhatsApp.

## Mensageria

- RabbitMQ: jobs duráveis de provisionamento, atualização, backup e ações administrativas.
- NATS JetStream: eventos de domínio/realtime entre Control Plane, Manager e futuros node agents.
- Kafka: opcional, destinado a streaming, replay, auditoria massiva e analytics; não é requisito do core.

## Cloudflare

A API administrativa de Cloudflare será consumida somente pelo Control Plane/provisioner. O Data Plane não recebe token administrativo de DNS.

Fluxo esperado:

```text
Tenant aprovado
 -> reserva slug
 -> escolhe node
 -> cria instalação
 -> provisiona database/namespace/storage
 -> cria DNS/hostname
 -> valida health
 -> marca instalação ACTIVE
```

## White-label

Toda capacidade genérica deve existir também em `platform-template/`. Elementos exclusivos de WhatsApp/Connect ficam somente em `control-plane/`.
