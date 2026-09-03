# Connect|API Platform — Identidade Canônica

## Regra de nomenclatura

- **UI e documentação:** `Connect|API Platform` / `Connect|API`.
- O caractere `|` faz parte da marca e não pode ser removido em peças oficiais.
- **DNS, Docker, Git, npm, paths:** `connect-api-platform` ou prefixo `connect-api`.
- **PostgreSQL/identificadores SQL:** `connect_api_platform`, `connect_api_tenant`, `connect_api_t`.
- Não use `Connect API Platform` como assinatura visual.

## Paleta oficial
- Primary `#2563EB`; Accent `#06B6D4`; Navy `#0F172A`; Muted `#64748B`; Surface `#F1F5F9`; White `#FFFFFF`.
- Light mode é o padrão canônico. Dark é variante.

## Assets
- Core: `branding/official/core/`;
- Fontes originais preservadas: `branding/official/*-source/`;
- DOCs: `branding/official/core/docs/`;
- PBX/VOIP: `branding/official/core/extensions/pbx-voip/`;
- Frontend runtime: `/brand/*`, `/icons/*`, `/favicon.ico`.

## Branding hierárquico

- Partner `PLATFORM`: usa `Connect|API Platform`; Partner `CUSTOM`: usa seu perfil publicado.
- Tenant de Partner: sempre herda a identidade efetiva do Partner.
- Tenant direto: usa `Connect|API Platform` por padrão e pode receber `CUSTOM` como exceção concedida pelo Control Plane.
- A identidade é resolvida pelo hostname antes do mount do frontend; não existe troca visual posterior.
- A infraestrutura interna continua usando namespaces técnicos Connect|API independentemente do branding externo.

## Assinatura Platform

O Control Plane e o Partner Plane utilizam a assinatura visual `Connect|API Platform`.

Assets runtime:
- `/brand/connect-api-platform.png`;
- `/brand/connect-api-platform-dark.png`.

Assets fonte:
- `branding/official/platform/ConnectAPI-PLATFORM.png`;
- `branding/official/platform/ConnectAPI-PLATFORM-DARK.png`.

O Tenant Plane pode substituir a marca principal pela identidade do tenant, preservando o design system da plataforma.
