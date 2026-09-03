# Branding Hierarchy — Connect|API Platform

## Modelo comercial imutável
A plataforma possui somente três atores: **Connect|API (Control Plane)**, **Partner** e **Tenant**. Tenant nunca possui outro Tenant e Partner nunca cria outro Partner.

## Regras
- Tenant direto (`partner_id IS NULL`): `INHERIT` usa Connect|API; `CUSTOM` usa branding próprio concedido pelo Control Plane.
- Tenant de Partner (`partner_id IS NOT NULL`): sempre herda a identidade efetiva do Partner e não pode publicar branding individual.
- Partner: `PLATFORM` usa Connect|API; `CUSTOM` usa seu BrandingProfile publicado.
- Alternar `PLATFORM/INHERIT ⇄ CUSTOM` não altera hierarquia, plano, banco ou ownership.
- Perfis são versionados: `DRAFT → PUBLISHED → ARCHIVED`. Publicação é atômica.

## Sem flash de marca
O hostname é resolvido por `/api/v1/public/branding/bootstrap.js` antes do primeiro mount do Vue. O HTML base é neutro. Host externo desconhecido falha fechado em identidade neutra; não presume Connect|API.

## Herança
Quando um Partner troca de `PLATFORM` para `CUSTOM` ou vice-versa, todos os seus Tenants passam a refletir a nova identidade sem cópia de assets/configuração em cada tenant.
