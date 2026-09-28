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
