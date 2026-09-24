# Find Hub — consultas reais e apresentação das coordenadas

Esta correção parte de `develop` após a PR #130. Não altera autenticação Google, extensão, motores WhatsApp, migrations, dependências, Compose nem política de retenção GHCR.

## Navegação e apresentação

Em **Dispositivos**, `Acompanhar no mapa` abre a página de mapa da mesma conta com `?device=<id>`; não abre modal. Os três botões usam os componentes/classes de ação existentes e quebram a linha por botão inteiro quando necessário. Nos cards de instância, o modal de acompanhamento permanece.

Mapa/modal, visão da conta e cards mostram latitude, longitude e horário do relatório efetivamente recebido. Zero é uma coordenada válida, não ausência de dados. As coordenadas exibidas têm sete casas decimais, sem interpolar trajetórias. O horário do relatório não é substituído pelo horário da interface.

Cards recebem o snapshot inicial e alterações pelo SSE autenticado existente. Não disparam consultas Google para atualizar o desenho. Fechar/desmontar o card libera conexão e reconexões; erro de autorização apaga o snapshot do componente. O seletor de dispositivo não reúne dados entre contas.

## Localizar agora

Uma solicitação realmente envia o comando Nova; os pushes recebidos são correlacionados por UUID da solicitação. O mesmo ponto com timestamp mais novo é uma observação nova, mesmo com o aparelho parado. Relatório criptografado inválido não encerra a espera nem impede receber um relatório posterior válido.

Antes, o primeiro push com relatório criptografado encerrava a espera, inclusive quando repetia a última posição. Agora, o receptor continua aguardando um relatório de data mais nova dentro do deadline escolhido. Se o prazo termina e somente relatórios antigos válidos foram recebidos **nessa solicitação**, a resposta conserva seus timestamps. Não é feito fallback silencioso para a posição do banco. Se não há resposta utilizável ou o envio não conclui no prazo, ocorre timeout e o ponto anterior não é apagado.

O timeout continua aceitando 1 ms; ele limita a espera, não a latência do Google, a produção de GPS ou a frequência de movimento. Intervalos 0/1/2+ continuam preservados. Não existem chamadas simultâneas para o mesmo dispositivo, nem timer que fabrique coordenadas. Retentar após falha continua sujeito ao recuo já existente.

## Compatibilidade e diagnóstico

O endpoint `POST /findhub/locate/{deviceId}/{instanceName}` continua retornando `FindHubPosition | null`. O diagnóstico adicional é disponibilizado em `lastQuery` no snapshot e em `data.query` nos eventos existentes:

- `new_report`: timestamp mais novo que o último relatório local; não implica GPS atual nem aparelho online.
- `known_position`: o Google repetiu um relatório já conhecido.
- `no_position`: resposta sem posição utilizável.
- `timeout`: deadline encerrado.
- `failed`: outra falha na solicitação.

Os campos `startedAt`, `completedAt` e `timeoutMs` distinguem a duração da consulta do horário da coordenada. Esse diagnóstico é temporário por conta/dispositivo e reinicia com o runtime; não contém credenciais. Uma observação anterior/duplicada não é encaminhada ao Traccar como uma nova posição. O histórico existente e a deduplicação permanecem.

## Validação

Testes cobrem relatório em cache seguido de novo, somente cache até o deadline, ausência de resposta, UUID diferente, posição inválida seguida de válida, mesmo ponto com timestamp novo, timeout de 1 ms, limpeza dos waiters, isolamento, snapshot atrasado, coordenada zero, navegação e renderização SSR das coordenadas. Testes sintéticos não substituem a homologação com Google e aparelhos reais.

## Receptor contínuo e respostas posteriores ao prazo local

A comparação com o `GoogleFindMyTools` fornecido para auditoria confirmou que o comando Nova `locateTracker` já tinha o mesmo conteúdo de wire: um teste independente serializado pelo protobuf Python compara todos os bytes do pedido TypeScript. Não foram trocados opcodes, autenticação, scopes ou chaves para tentar forçar uma frequência de GPS.

Dois pontos do ciclo de recepção foram corrigidos:

1. O receptor TypeScript respondia a heartbeats do servidor, mas não detectava ativamente uma conexão MCS silenciosamente interrompida. Agora envia heartbeat após 20 segundos sem frame, aguarda atividade por 5 segundos e usa a reconexão existente em caso de falha. São parâmetros do transporte presentes na referência, não intervalos de localização.
2. Encerrar a espera HTTP ou receber o primeiro relatório retirava o UUID da tabela e descartava observações seguintes. Agora uma correlação originada por esta conta é conservada por até 120 segundos após encerrar a espera, com no máximo 512 contextos por conexão. Isso permite receber e validar fixes posteriores sem estender o timeout escolhido ou manter requisições HTTP abertas. UUID desconhecido, documento de outro aparelho, observação antiga, contexto expirado ou conexão encerrada são rejeitados.

Uma observação posterior é desserializada e descriptografada no próprio cliente TypeScript. O runtime revalida conta/dispositivo, serializa as gravações, deduplica e publica latitude/longitude nos eventos e no SSE existentes. O status adicional `late_report` identifica a atualização posterior; não é uma resposta HTTP de sucesso retroativa. A correlação é removida ao parar o rastreamento, desconectar ou encerrar o runtime. Trabalho de persistência enfileirado antes de uma parada é invalidado. A observação não volta a ligar o rastreamento.

O timeout de 1 ms continua sendo respeitado e pode abortar o comando antes de ele chegar ao Google. Não existe uma nova coordenada para recuperar quando nenhum comando foi recebido e nenhum relatório foi enviado pelo provedor. Para distinguir essa condição de um defeito de recepção, um teste útil mantém o intervalo desejado (por exemplo 1 segundo), mas usa um prazo de espera suficiente para a comunicação (por exemplo 30000 ms). Isso não muda a frequência configurada nem exige esperar 30 segundos quando a resposta chega antes.

A referência fornecida mantém um listener de notificações em background e oferece consultas; ela não documenta garantia de nova coordenada por segundo. Realtime no Manager é a entrega por evento de cada observação validada. Disponibilidade, horário e precisão continuam vindo do provedor. Não se coleta PIN, senha, sessão de outro usuário ou dados que não tenham sido autorizados.

## Regressões adicionais

Foram incluídos cenários de perda silenciosa da conexão, ACK do heartbeat, falha de escrita no socket, resposta depois do timeout, segunda observação depois do primeiro resultado, correlação expirada/desconhecida, parada com trabalho enfileirado, concorrência com consulta manual e um payload protobuf/AES-GCM sintético completo que percorre desserialização, descriptografia, persistência e emissão para o assinante da conta. Um teste da lista de canais mantém o ramo visual WhatsApp e usa o ícone de localização existente para Google Find Hub. Nenhum teste sintético representa um ensaio de GPS com aparelho real.
