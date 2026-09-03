# Migração — Manager legado → Connect|API Platform

## O que muda

- `/manager` deixa de ser servido pela API;
- a imagem do Engine não contém mais `platform/web`;
- funcionalidades novas de UI pertencem a `platform/web`;
- o Engine continua atendendo REST/Webhooks/Socket/Providers normalmente;
- DOCs permanece uma imagem independente;
- a Platform completa é opcional e habilitada por profile.

## Compatibilidade

Não são alterados nesta migração:

- package técnico `argws-connect-api`;
- schemas/migrations operacionais do Engine;
- endpoints públicos existentes;
- providers WhatsApp/CONNECT;
- Actions, Recipes, Templates, Micro Apps e eventos;
- processo `develop → main → SemVer`.

## Migração operacional

### API-only existente

Pode continuar consumindo somente `argws-connect-api` e infraestrutura base.

### API + DOCs

Use profile `docs` no deployment unificado.

### Produto completo

Use profile `platform`. Configure secrets da Platform, domínio, Control Plane e a mesma `AUTHENTICATION_API_KEY` que autoriza o bridge server-side ao Engine.

## Manager antigo

O Manager legado foi removido fisicamente nesta frente. Apenas `manager/DEPRECATED.md` permanece como tombstone documental; novas experiências administrativas vivem em `platform/web`.
