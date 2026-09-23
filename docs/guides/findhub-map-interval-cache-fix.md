# Correção incremental: mapa, intervalo e retenção de cache

## Intervalo definido pelo operador

API, Manager, persistência e restauração aceitam inteiros de 0 a 86400 segundos.
0 significa iniciar a próxima consulta após finalizar a anterior, sem espera adicional.
1 e 2 segundos são válidos. A recomendação de 60 segundos não é uma restrição.
A variável histórica FINDHUB_MIN_TRACKING_INTERVAL_SECONDS é mantida por compatibilidade,
mas não impõe um limite aos valores explícitos. O default existente não é sobrescrito.
Falhas, ausência de posição e limitações do Google provocam recuo progressivo sem alterar
os parâmetros salvos. Uma solicitação manual em andamento não provoca consultas paralelas
nem laço ocupado. SSE continua entregando cada posição recebida, sem inventar coordenadas.
O Google pode fornecer a última posição conhecida; o intervalo solicitado não garante GPS contínuo.

## Mapa

As imagens de tiles usam `referrerpolicy="strict-origin"` explicitamente. O Manager mantém
seu cabeçalho global de privacidade; apenas o pedido do mapa envia a origem, sem caminhos,
nome da conta, tokens ou parâmetros de sessão. Mantêm-se cache HTTP normal e atribuição.
Somente os tiles do viewport são solicitados. Erros interrompem novos pedidos até uma
nova tentativa manual, mantendo a posição recebida e expondo uma mensagem de diagnóstico.
Não há troca automática de servidores para contornar bloqueios. O provedor pode continuar
bloqueando a rede por outros motivos; configure FINDHUB_MAP_TILE_URL com um serviço autorizado
nessa situação. Referências: https://operations.osmfoundation.org/policies/tiles/ e
https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/referrerPolicy .

## Manager

A página Find Hub utiliza o PageHeader, provider-hero, config-layout, config-nav-item,
config-workspace, field, toggle-field e event-grid já existentes. Os botões Salvar/Voltar
ficam no cabeçalho, sem botões azuis de largura total nas configurações.
Os transportes de eventos aparecem individualmente na navegação de configuração.
Não foram importados formulários de WhatsApp nem habilitados recursos de mensagens,
presença, leitura, Chatwoot ou chamadas no Find Hub. As telas e motores WhatsApp permanecem intactos.

## Retenção e desempenho do pipeline

A auditoria do run 35825115076 mostrou publicação da API/Manager concluída às 06:10:10 UTC,
mas retenção concluída às 06:41:35 UTC: inventário duplicado e espera por outros workflows.
O relatório anterior marcou `mode=blocked`, 578 caches candidatos e zero exclusões.

O workflow de retenção continua sendo chamado depois do sucesso da publicação, inclusive
em develop. A limpeza de Actions caches é independente do inventário GHCR e executa primeiro.
Ela exige publicação real validada, preserva caches usados/criados nas últimas duas horas,
refs com builds ativos, caches da branch padrão enquanto outra execução pode restaurá-los,
refs de tags e dados com escopo/idade desconhecidos. Reconfere o último acesso antes de excluir
cada cache, trabalha com IDs exatos, no máximo quatro operações simultâneas e registra o plano
antes das exclusões. Falha, PR, branch não publicada ou commit substituído não autorizam exclusão.

A varredura GHCR possui gate antes do inventário. Foi removida a espera de dez minutos e o
inventário duplicado dry-run/apply: o script já persiste o plano antes de aplicar. Também foi
removido o disparo duplicado workflow_run; os quatro publishers existentes mantêm suas chamadas
reutilizáveis diretas. Nenhum teste de qualidade/segurança foi desabilitado.
A política e os digests canônicos 1.1.3 permanecem inalterados. O worker de cache só exclui caches;
não exclui imagens, tags, releases ou arquivos de release. A retenção GHCR mantém suas proteções.
Os registros diagnósticos dockerbuild passam de retenção padrão de 90 dias para um dia; os
artefatos oficiais de release não são afetados. Cache de tiles do navegador não é cache de CI
nem participa desta limpeza.
