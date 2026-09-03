# Manager legado — removido e desativado

O frontend histórico `manager/dist` foi **retirado definitivamente** nesta frente de produto.
Ele não é servido pelo Engine, não é copiado para imagens e não possui container próprio.

## Sucessor

A experiência administrativa oficial é a **Connect|API Platform Web** em `platform/web`,
com Control Plane, Partner Plane, Tenant Plane e os Studios do produto.

## Compatibilidade

A remoção do Manager não altera os endpoints REST do Connect|API Engine. Deployments
`api` e `docs` continuam API-first; o frontend existe apenas no profile `platform`.
