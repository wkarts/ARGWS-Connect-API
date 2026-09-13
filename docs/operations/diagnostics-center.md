# Centro de Diagnóstico nativo

O Manager oferece **Sistema → Diagnóstico** (`/diagnostico`). A coleta começa automaticamente na inicialização da API; não exige variável de ambiente, agente externo ou migração de banco. O módulo de Operações existente continua disponível para suas métricas agregadas.

## Usar e baixar

1. Atualize a API e o Manager com esta alteração e entre com o acesso global do administrador da instalação.
2. Abra **Sistema → Diagnóstico**. Verifique o indicador de persistência.
3. Reproduza a operação problemática e escolha o período correspondente. Para acompanhar enquanto testa, ative a atualização automática de cinco segundos.
4. Filtre por nível, categoria, ID da requisição, ID da chamada ou pseudônimo da instância. Clicar em um identificador de evento aplica esse filtro.
5. Clique em **Baixar diagnóstico**. O arquivo contém o período e os filtros aplicados por inteiro, incluindo eventos ainda não carregados na tabela. Escolha `.jsonl.gz` para compartilhar ou `.jsonl` para ler diretamente.

O download começa com um manifesto (versão da API, instante da exportação, filtros, estado do armazenamento e contadores) e continua com um evento JSON por linha. IDs e horários permitem correlacionar os eventos entre duas instalações. Relógios dos servidores devem estar sincronizados para comparar tempos; o `callId` também permite cruzar as duas pontas sem depender da ordem dos relógios.

## Diagnosticar atendimento API → API

Reproduza uma única chamada e baixe o mesmo intervalo nas duas instalações. Use a categoria **Chamadas** e o mesmo `callId`, ou exporte todas as categorias para incluir HTTP, webhooks e erros associados.

Os eventos separam:

- `call.action`: comando solicitado, retorno do método do provider ou falha, com o `traceId` da requisição e `callId` quando disponível;
- `call.signaling`: oferta, aceite, término, ACK e estrutura técnica do protocolo, com JIDs pseudonimizados e IDs dos dispositivos;
- `call.state`: direção e estado informado pelo provider, incluindo atendimento em outro dispositivo e encerramento;
- `call.media`: estado do canal WebSocket entre navegador e API, sem áudio ou conteúdo dos frames;
- `webhook.delivery`: tentativas, resultado, status HTTP e duração de entrega nativa/Meta Compatible;
- `http.request` e `runtime.error`: retorno HTTP, duração e informações técnicas sanitizadas dos erros.

**`call.action` com fase `completed` significa que o método do provider retornou. Não comprova que a outra API aceitou a chamada.** Do mesmo modo, `transport_out` é o evento de saída observado no transporte Zapo, emitido antes de concluir a escrita de rede; não comprova entrega. Compare com o ACK e o sinal recebido na outra ponta. WebSocket autenticado indica que o canal de áudio navegador/API está preparado; não confirma o atendimento WhatsApp remoto.

Este módulo fornece evidências para investigar a falha. Ele não altera o protocolo de aceite nem declara resolvido o defeito de atendimento API → API.

## Dados registrados e excluídos

| Registro | Metadados permitidos |
| --- | --- |
| HTTP | Método, rota modelo com parâmetros ocultos, status, duração, interrupção e UUID de rastreio gerado pela API |
| Erro | Classe/código reconhecidos, status, posições sanitizadas de stack e fingerprint técnico |
| Conexão | Provider, estado conhecido, motivo técnico reconhecido e pseudônimo de instância |
| Chamada | IDs técnicos, ação/fase, direção/estado, tags permitidas de sinalização, JIDs pseudonimizados e números dos dispositivos |
| Webhook | Evento conhecido, fase/tentativa, status/duração e identificador pseudônimo do destino |
| Execução | Versão da aplicação/Node, uptime, uso de memória e CPU |
| Manager | Tipo fixo de erro e tela conhecida |

**Não são coletados** conversas, texto de mensagens, contatos, nomes, telefones em claro, áudio, vídeo, mídia, corpos HTTP, headers, cookies, query strings, URLs, tokens, chaves, tickets de mídia, QR/pairing codes, bytes criptografados, SQL ou mensagens livres de exceções. Não há captura do console bruto nem de `stdout/stderr`.

Cada evento é reconstruído por uma lista de campos permitidos antes de entrar no armazenamento. Instâncias, destinos e JIDs usam pseudônimos SHA-256 truncados, estáveis para correlação; isso é pseudonimização, não promessa de anonimato irreversível. IDs de chamada, stanza e requisição permanecem técnicos e correlacionáveis.

O rastreio HTTP não guarda valores de parâmetros. Polling bem-sucedido de Diagnóstico, Operações, saúde e arquivos estáticos não preenche o próprio histórico. O diagnóstico dos webhooks registra somente a entrega, mesmo quando o evento transporta mensagens: seu conteúdo não entra no registro.

## Persistência e limites

Os arquivos ficam em `instances/_diagnostics`, dentro do volume de instâncias já usado pelo deployment suportado. O diretório é privado (`0700`), com arquivos `0600`, fora das rotas estáticas. Use um processo de API por volume de diagnóstico. Cada instalação tem seu histórico; não há coletor central entre réplicas.

Padrão: **7 dias e 128 MiB**. A seção **Retenção do diagnóstico** permite ajustar de 1 a 30 dias e de 32 a 512 MiB. Os limites são persistidos e aplicados sem reiniciar. Reduzi-los pode remover o histórico mais antigo; a tela informa esse efeito antes de salvar. A disponibilidade do histórico depende tanto do prazo quanto do espaço.

A fila é limitada a 1.000 registros, com gravação assíncrona em lotes, segmentos de até 4 MiB e compactação de segmentos pequenos. O sinalizador Zapo limita a coleta a 300 eventos por cliente/minuto e registra a supressão; erros do frontend têm limite local de 6/minuto e limite adicional no servidor. Saturação, descarte e falha de disco aparecem no painel. O sistema prioriza manter chamadas e requisições funcionando mesmo se o diagnóstico falhar.

Na indisponibilidade do disco, o armazenamento mantém uma reserva limitada em memória, exportável enquanto o processo estiver ativo, e sinaliza degradação. Essa reserva não é durável. A criação/reinicialização do container preserva o histórico somente se o volume existente estiver montado. Um encerramento abrupto pode perder eventos ainda na fila; os segmentos já publicados são recuperados na inicialização. Corrupção é sinalizada e linhas válidas continuam legíveis.

Consultas e downloads são limitados a quatro leitores simultâneos, com no máximo duas exportações; o cancelamento do download libera o leitor. O servidor transmite o arquivo em fluxo, sem juntar todo o histórico em memória. O navegador prepara um Blob para o download, limitado pelo volume de retenção configurado.

## API administrativa

Todas as rotas abaixo exigem `apikey` com a **chave global** configurada na instalação. Chaves de instância são rejeitadas. A chave segue em header, nunca na URL ou no arquivo. As respostas usam `Cache-Control: no-store`.

| Método e rota | Uso |
| --- | --- |
| `GET /diagnostics/status` | Persistência, retenção, espaço, descarte, contadores e versão |
| `GET /diagnostics/events` | Histórico paginado; `limit` de 1 a 200 e cursor opaco |
| `GET /diagnostics/export` | Histórico completo filtrado; `format=gzip` ou `format=jsonl` |
| `PUT /diagnostics/settings` | JSON `{ "retentionDays": 7, "maxDiskMB": 128 }` |
| `POST /diagnostics/client-events` | Evento técnico do Manager, sem mensagens/stack/payload |

Filtros compartilhados: `from`, `to` (ISO UTC), `level`, `category`, `code`, `traceId`, `callId` e `instanceId`. A exportação não recebe cursor ou limite de página. A resposta HTTP da API fornece `X-Request-Id`, gerado internamente; um valor enviado pelo cliente não substitui esse identificador.

## Verificação

```sh
npm run test:diagnostics
npm run test:voip
npm run build
npm run docs:check
npm --prefix manager test
```

As regressões usam filesystem e HTTP reais localmente, com providers/transportes de teste: validam autenticação, privacidade, correlação, reinício, retenção, quota, exportação gzip/JSONL e cancelamento. Elas não substituem a reprodução com duas contas WhatsApp reais depois da atualização.
