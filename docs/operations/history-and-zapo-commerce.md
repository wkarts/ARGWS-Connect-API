# Histórico operacional, grupos e catálogo ZAPO

## Histórico privado, sem dados de comunicação

A Visão Geral utiliza `/operations/snapshot`, `/operations/history`, `/operations/archives` e `/operations/export`. Essas rotas exigem a **API key GLOBAL**, não o token de uma instância. O navegador nunca recebe o token do agente. Não consulta mensagens, contatos, instâncias ou webhooks para preencher o painel. Não há gráficos demonstrativos nem indicadores de segurança fixados como saudáveis.

A lista positiva de eventos e campos fica em `operations-agent/store.cjs`. Corpo de mensagem, nome de contato, telefone, PN/LID/JID, URLs, cabeçalhos, credenciais, fotos, QR, anexos e áudio NÃO são aceitos pelo registro operacional. Campos novos/desconhecidos são descartados, inclusive durante a leitura histórica. O agente não coleta logs brutos de bibliotecas/containers: não é uma cópia de stdout nem de conversas.

## Arquivos diários e consulta sem carregar o banco

Os eventos recentes são append-only em `live/AAAA-MM-DD.jsonl`. Não há novas tabelas de logs no PostgreSQL. O serviço verifica uma vez por minuto se existem dias encerrados segundo `TZ` (padrão do deployment: America/Bahia).

O arquivamento cria `archives/AAAA-MM-DD.jsonl.gz` e um manifesto `.json`. A remoção do arquivo recente exige compressão concluída, descompressão e SHA-256 conferidos, fsync e publicação atômica do manifesto. Arquivo corrompido ou divergente NÃO autoriza apagar o original. A manutenção é idempotente. SHA-256 detecta corrupção; não é assinatura nem prova forense.

Padrões: três dias de arquivos recentes e noventa dias compactados. Índice e GZIP ficam no volume persistente, não no banco. Consultar um período anterior lê os arquivos diretamente, sem reimportar registros. Limites: 31 dias por consulta, 200 eventos/página, uma leitura histórica/exportação simultânea no agente, 16 MiB/dia e 512 MiB de armazenamento. Ao atingir limites, o monitor indica perda de coleta em vez de afetar WhatsApp. A retenção não apaga mensagens ou sessões.

A exportação de um dia produz `.log.gz` legível; `format=jsonl` mantém dados estruturados. Download não inclui banco, `.env`, credenciais nem sessão. Paginação usa `nextCursor`. Datas consultadas são dias inclusivos no fuso configurado; registros usam ISO-8601 UTC, apresentados no fuso do navegador.

## Habilitação no Compose existente

O serviço utiliza a mesma imagem/versionamento da API, mas executa somente Node com módulos nativos e entrypoint próprio: não abre WhatsApp, não executa migrations nem carrega Prisma. Sem docker.sock, modo privilegiado ou porta pública. Limites: 0,5 CPU / 192 MiB; não são promessa de consumo ou impacto zero. CPU e disco do host continuam compartilhados.

Use `deploy/develop/compose.yaml` ou `deploy/production/compose.yaml` atualizado:

```env
COMPOSE_PROFILES=operations
OPERATIONS_ENABLED=true
OPERATIONS_INTERNAL_TOKEN=GERAR_UM_SEGREDO_ALEATORIO_DE_PELO_MENOS_32_CARACTERES
ARGWS_CONNECT_OPERATIONS_DATA_PATH=./volumes/operations
OPERATIONS_HOT_DAYS=3
OPERATIONS_RETENTION_DAYS=90
```

Gere com `openssl rand -hex 32`. Não reutilize a API key global. Se houver perfis em COMPOSE_PROFILES, acrescente `operations`. O serviço é opcional por padrão. Sem habilitação o dashboard informa ausência de monitoramento. Atualize a imagem da API e execute `docker compose --profile operations up -d`. Não use `down -v`, não remova volumes e não faça novo pareamento por causa desta entrega.

As verificações HTTP/TCP acontecem a cada 30 segundos, uma vez por serviço, não por navegador. TCP acessível NÃO comprova integridade de banco/fila. A API agrega quantidade/duração e falhas HTTP 5xx sem dados das requisições, enviando em lotes. Telemetria é melhor esforço: intervalos perdidos são sinalizados quando a comunicação volta. Não é um livro contábil de mensagens.

## Backups não são logs

Os scripts `.connectbak` continuam separados e com a criptografia atual. Criação, verificação e restauração executadas por eles geram eventos quando o agente está disponível, sem nome do arquivo/credenciais. Esta entrega NÃO agenda backups completos e NÃO torna o backup sem interrupção: o script ainda para a API para captura consistente. Checksum não substitui teste real de restauração de sessão.

## Grupos

`remoteJid` de grupo termina em `@g.us` e é preservado, inclusive grupos antigos com hífen. `participant`/`participantAlt` identificam o autor, jamais substituem o grupo. O grupo recebe assunto e imagem próprios, não o pushName do autor. O Manager identifica o grupo e apresenta autor nas mensagens recebidas.

A consulta é pontual, com deduplicação e cache limitado: cinco minutos para metadados válidos, trinta segundos após falha. Sem varredura periódica de contatos, mensagens ou grupos. `groupsIgnore` vale também no recebimento. Registros anteriores podem ser atualizados por **Atualizar grupo**, usando a rota existente `GET /group/findGroupInfos/{instanceName}`. Nenhuma conversa é apagada. Envio mantém JID completo nos providers.

## Catálogo comercial ZAPO: implementação real de leitura

`businessCatalog: true` corresponde à superfície de leitura do Connect para Baileys: `POST /business/getCatalog/{instanceName}` e `POST /business/getCollections/{instanceName}`. Não anuncia CRUD de produtos.

O plugin `connect-commerce` usa a API pública `WaClientPluginContext.queryWithContext` da versão **1.6.3** já instalada. Consulta `w:biz:catalog`, `product_catalog` e `collections` na sessão ZAPO existente. Sem Baileys oculto, segunda sessão, conversão de credenciais, imports privados ou atualização de dependências. É uma extensão Connect|API pela API pública de plugins, não um coordenador comercial pronto do upstream.

Produtos retornam identificador, nome, descrição, preço/moeda, imagens e metadados presentes. Preço mantém unidades do protocolo como no contrato existente; não é dividido silenciosamente por cem. Disponibilidade desconhecida não vira estoque fictício. Cursores são opacos.

```json
{"number":"5511999999999","limit":10,"maxPages":1}
```

Envie `nextPageCursor` como `cursor` para a próxima página. Limites: 100 itens/página, até vinte páginas explícitas. Pedidos idênticos simultâneos são deduplicados. Coleções incluem produtos retornados pelo WhatsApp. Erro/permissão negada/resposta desconhecida não vira catálogo vazio falso. LID não vira telefone por dígitos e grupo não é dono de catálogo.

Testes verificam IQ, parsing, cursores, erros, concorrência, grupo/LID e arquivamento seguro com consulta posterior. Homologação real ainda requer sessão WhatsApp Business com produtos visíveis: fixtures não são confirmação de produção. Mudanças futuras do protocolo podem exigir manutenção.

Referências: ZAPO v1.6.3 `src/client/plugins/types.ts` e `src/index.ts`; Baileys v7.0.0-rc.9 `src/Socket/business.ts` e `src/Utils/business.ts`, nos repositórios oficiais.
