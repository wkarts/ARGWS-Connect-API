# Release Notes — v1.0.0-rc.20

A rc.20 é uma rodada de hardening funcional baseada em uso real da plataforma após a rc.19. O foco deixa de ser somente estrutura/infra e passa a cobrir comportamento financeiro de ponta a ponta, segurança de apresentação pública e experiência operacional.

## Principais correções

- remove bloqueio indevido de navegação normal pelo rate limit genérico;
- mantém limitação somente nas superfícies sensíveis que realmente precisam dela;
- corrige auditoria que transformava operações já disparadas em HTTP 500 quando não havia `entity_id`;
- backup manual passa a ser acompanhado e atualizado automaticamente na grade;
- exportações passam a serializar UUID e estruturas corretamente;
- relatórios financeiros ganham filtros, impressão, PDF, XLSX e CSV;
- relatório de carteira passa a mostrar empresa e cliente legíveis;
- contratos ganham exclusão lógica auditada controlada por `contracts.delete`;
- negociações passam a exibir todas as parcelas efetivamente geradas e sinalizar divergências;
- conciliação passa a usar transações bancárias importadas, criar sugestões e exigir confirmação em correspondências não inequívocas;
- confirmação de conciliação registra pagamento e atualiza o saldo do título de forma auditada;
- portal público de cobrança passa a gerar QR Code PIX, PDF de boleto público e upload imutável de comprovante;
- nenhum link público de boleto depende de autenticação do tenant;
- WhatsApp/Evolution passa a consultar estado e inventário em paralelo, com timeout operacional curto e preservação da sessão durante restart;
- landing page pública deixa de expor Control Plane, demo, providers, arquitetura ou URLs internas;
- landing passa a consumir somente conteúdo comercial autorizado e planos públicos do Control Plane;
- Control Plane passa a habilitar/desabilitar a landing, editar textos, CTA e galeria opcional de screenshots;
- sistema recebe componente global de diálogo próprio para substituir confirmações/prompts do navegador;
- tradução PT-BR ampliada para estados financeiros e administrativos.

## Segurança da landing

A landing pública não deve revelar:

- hostname do Control Plane;
- URL de demonstração;
- APIs/providers utilizados;
- banco, filas, storage ou arquitetura interna;
- repositórios, imagens de container ou detalhes de provisionamento.

Somente informações comerciais explicitamente habilitadas podem sair pelo endpoint público da landing.

## Conciliação

O motor diferencia:

1. pagamento já registrado e transação bancária correspondente — conciliação automática;
2. crédito bancário com título candidato único/forte — sugestão para conferência;
3. múltiplos candidatos equivalentes — nenhuma baixa automática.

A confirmação de uma sugestão cria o pagamento idempotente a partir da transação bancária, atualiza saldo/status do título e registra auditoria.

## Versão

`1.0.0-rc.20`
