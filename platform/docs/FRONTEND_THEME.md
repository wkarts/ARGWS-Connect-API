# Connect|API Platform — Frontend Visual Canônico

## Objetivo

Este documento define o frontend visual padrão da Connect|API Platform para três contextos:

1. **Control Plane** — administração global da plataforma;
2. **Partner Plane** — operação delegada para parceiros/revendedores;
3. **Tenant Plane** — ambiente isolado de cada tenant.

A referência visual oficial desta revisão está em:

- `branding/official/platform/FRONTEND-REFERENCE.png`;
- `branding/official/platform/ConnectAPI-PLATFORM.png`;
- `branding/official/platform/ConnectAPI-PLATFORM-DARK.png`.

## Direção visual

- Light mode como padrão;
- sidebar branca fixa;
- topbar branca com bordas discretas;
- fundo geral `#F8FAFC`;
- cards brancos com borda `#E5EAF2`;
- azul Connect|API `#2563EB` como cor primária;
- ciano `#06B6D4` como accent;
- navy `#0F172A` para tipografia principal;
- sombras mínimas;
- radius predominante entre 8 e 12 px;
- alta densidade informacional sem aparência pesada;
- menus compactos e consistentes entre os três planes.

## Design system runtime

Os tokens e componentes globais ficam em:

- `frontend/src/styles/main.css`;
- `frontend/src/components/PageHeader.vue`;
- `frontend/src/components/StatCard.vue`;
- `frontend/src/layouts/AppLayout.vue`.

As classes principais incluem:

- `.app-shell`;
- `.app-sidebar`;
- `.app-topbar`;
- `.card`;
- `.metric-card`;
- `.dashboard-panel`;
- `.nav-item`;
- `.context-button`;
- `.topbar-search`.

## Control Plane

O dashboard usa apenas dados reais atualmente fornecidos pelo backend:

- tenants totais;
- tenants ativos;
- provisionamento;
- falhas de provisionamento;
- domínios;
- lista recente de tenants;
- auditoria recente.

Métricas que ainda não possuem séries temporais próprias — como tráfego agregado de API e MOS de VOIP — aparecem como áreas preparadas, sem números inventados.

## Tenant Plane

O dashboard consulta, quando permitido:

- `GET /api/v1/connect/capabilities`;
- `GET /api/v1/users`;
- `GET /api/v1/api-keys`;
- `GET /api/v1/outbound-webhooks`;
- `GET /api/v1/audit/events`.

O logo do tenant continua respeitando whitelabel por hostname. Quando não houver logo customizado, a marca Connect|API é utilizada como fallback.

## Partner Plane

O frontend do parceiro foi criado como plane próprio e pode ser visualizado em desenvolvimento com:

```text
?partner=1
```

ou por hostname iniciado por `partner.`/`partners.`.

### Regra de segurança obrigatória

O Partner Plane **não pode utilizar endpoints `/api/control/v1/*`**.

Nesta revisão, a UI do parceiro está preparada, porém o backend dedicado de parceiros ainda não existe. Por isso, módulos de carteira, planos, consumo, domínios, API Keys e whitelabel exibem estado de preparação em vez de reutilizar permissões administrativas globais.

Quando o backend de parceiros for implementado, deverá possuir:

- autenticação própria ou contrato explicitamente delegado;
- escopo de tenants permitidos;
- RBAC de parceiro;
- auditoria própria;
- endpoints exclusivos;
- nenhuma elevação implícita para `PLATFORM_*`.

## Logos

O Control Plane e Partner Plane utilizam a assinatura `Connect|API Platform`:

```text
/brand/connect-api-platform.png
/brand/connect-api-platform-dark.png
```

O Tenant Plane pode usar branding específico do tenant.

## Responsividade

- Desktop: sidebar fixa de 258 px;
- Mobile/tablet: sidebar em drawer;
- cards adaptam de 1 para 2/5 colunas conforme largura;
- tabelas permanecem horizontais quando necessário;
- busca global é ocultada em larguras menores.
