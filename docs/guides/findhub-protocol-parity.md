# Find Hub — paridade criptográfica e recepção contínua

## Base da comparação

Código Connect|API: `develop` em `bc7d61a066e6859634c867beb6a56c57e9b87097` (merge da PR #131).
Referência fornecida pelo operador: `GoogleFindMyTools-main(2).zip`, SHA-256 `1c3d09e1a7739cde0f7d10912f6e6041d16de596bccb16dfaf194872f5367b55`.
O arquivo foi usado para leitura e comparação; não foi adicionado como dependência, fork ou serviço da aplicação.

Arquivos de referência examinados: `NovaApi/ExecuteAction/LocateTracker/location_request.py`, `decrypt_locations.py`, `NovaApi/ExecuteAction/nbe_execute_action.py`, `FMDNCrypto/foreign_tracker_cryptor.py`, `FMDNCrypto/eid_generator.py`, `Auth/fcm_receiver.py`, `Auth/firebase_messaging/fcmpushclient.py` e os schemas de `ProtoDecoders`.

## Divergências reproduzidas e corrigidas

1. **Contador do beacon:** a chave efêmera dos relatórios de rede deve usar `deviceTimeOffset` diretamente. A portabilidade utilizava `timestampSeconds - deviceTimeOffset`, produzindo uma chave diferente. O horário Unix do relatório continua sendo o horário da posição, não a entrada desse cálculo.
2. **AES-EAX/CMAC:** K2 é a duplicação de K1 no campo binário; o código executava outro AES sobre K1. Isso fazia relatórios com bloco parcial falharem na autenticação criptográfica. A comparação da tag agora usa tempo constante.
3. **Seleção do cifrador:** o original seleciona AES-GCM quando `publicKeyRandom` está vazio e ECDH/HKDF/AES-EAX quando existe chave pública. `isOwnReport` é atribuição do relatório e não substitui esse critério.
4. **Vida útil da correlação FCM:** o receptor eliminava o UUID ao concluir ou expirar uma consulta, descartando qualquer atualização posterior daquele comando. Agora mantém, por até dois minutos, no máximo 256 contextos recentemente solicitados por conta. Relatórios novos correlacionados podem chegar ao runtime depois do retorno HTTP e também depois da primeira resposta bem-sucedida.
5. **Conexão silenciosamente interrompida:** faltava o monitor ativo de heartbeat do receptor de referência. Uma conexão autenticada ociosa é sondada após 20 segundos; ausência de resposta por cinco segundos fecha o socket e aciona a reconexão existente. Parar o receptor limpa o monitor e o temporizador de reconexão.

O escalar secp160r1 também passa a ser serializado com quantidade par de dígitos hexadecimais para preservar seu bit adicional quando necessário.

## O que foi verificado e não precisou mudar

O comando Nova `ExecuteActionRequest` gerado em TypeScript foi comparado byte a byte com a serialização do módulo protobuf Python do ZIP usando identificadores sintéticos. Os 101 bytes da amostra são idênticos, incluindo SPOT, `FMDN_ALL_LOCATIONS`, UUID, cliente e receptor. Não foi inventado um novo modo de GPS nem alterado o comando que já estava correto.

O script original espera uma resposta correlacionada via FCM e a descriptografa. Esse código não demonstra uma garantia de GPS novo a cada segundo. A precisão e o timestamp disponíveis continuam sendo os efetivamente enviados pelo Google/dispositivo; a aplicação não os melhora artificialmente.

## Encaminhamento de uma observação recebida

`FCM autenticado → UUID recentemente emitido → validação do dispositivo → descriptografia → validação da posição → fila limitada por dispositivo → persistência → SSE/eventos → mapa/cards e Traccar`.

A fila serializa observações concorrentes do mesmo dispositivo. O runtime verifica conta, dispositivo, geração da conexão e monotonicidade do horário. Uma repetição, um relatório anterior ou dados de outro dispositivo não são publicados como nova localização. A última posição e seu horário original são preservados. Parar o rastreamento revoga as correlações recentes daquele dispositivo; fechar/reconectar invalida as da conexão anterior.

O contrato HTTP de localização e os eventos existentes permanecem. O encerramento da espera HTTP não significa que um push já solicitado possa ser descartado. Não há polling adicional no frontend nem interpolação de movimento.

## Timeout e intervalo permanecem escolhas do operador

Intervalos `0/1/2+` continuam aceitos; o timeout continua aceitando 1 ms. Nenhum valor é aumentado silenciosamente. O prazo HTTP ainda aborta o envio quando expira. Portanto, um timeout tão curto pode impedir que o comando chegue ao Google; a recepção posterior só é possível quando um comando realmente foi recebido pelo provedor. A janela limitada de correlação não é um segundo timeout escondido e não fabrica respostas.

Para a homologação do recebimento, é necessário que o prazo permita concluir o envio e receber dados reais. A frequência de atualização escolhida não é uma garantia de que o aparelho produza uma nova coordenada nessa frequência.

## Interface e escopo preservado

A lista **Canais** passa a usar o ícone de localização já existente no Manager para Google Find Hub, mantendo o ícone e o estilo WhatsApp. Não há mudança no complemento do navegador, no login Google, no desbloqueio do cofre, em migrations, dependências, Compose, imagens ou política de retenção/canonização da versão 1.1.3. As funções de descriptografia da chave do proprietário e da chave de identidade não foram alteradas.

## Validação reproduzível

`node --test test/findhub-tracking.test.cjs` inclui as novas regressões e `test/findhub-live-parity.test.cjs`, com vetores em `test/fixtures/findhub-location-parity.json`.

Os vetores de localização são sintéticos: foram produzidos por uma implementação Python independente das fórmulas, com AES/CMAC/HKDF de `cryptography` e cálculo afim da curva elíptica. Não usam a implementação TypeScript sob teste para cifrar e não contêm dados de contas reais. O teste do comando usa a serialização protobuf do ZIP. O runtime Python completo não foi executado nem adicionado ao CI.

No ensaio negativo inicial, 14 regressões falharam sobre a base anterior e passaram após a correção; os 60 testes restantes daquela execução já passavam. A suíte ampliada final contém 76 testes aprovados, incluindo rejeição de UUID/dispositivo incorreto, expiração, parada, limite de memória, sequência de observações, SSE, histórico, Traccar e heartbeat. A suíte completa do Manager passou com 134 testes, tipos e build; a lista de canais foi renderizada em teste SSR para conferir os três casos de ícone (localização, WhatsApp e genérico).

O diagnóstico sanitizado fornecido foi analisado localmente. Ele contém erros de runtime/HTTP, mas não inclui payloads de localização descriptografados nem informação suficiente para atribuir cada atraso a uma destas divergências. Não foi publicado no repositório. Estes testes comprovam os defeitos e as correções reproduzidas, não substituem homologação com a conta Google e os aparelhos físicos em movimento. Nenhuma autenticação real foi feita nesta revisão.


## Rastreamento contínuo: envio e recepção desacoplados

O rastreamento de fundo não utiliza mais a chamada bloqueante usada pelo botão **Localizar agora**. Cada ciclo envia o comando Nova e retorna assim que o Google aceita a solicitação; as observações correlacionadas chegam de forma independente pela conexão FCM e são aplicadas imediatamente ao histórico, SSE, mapa, cards e Traccar.

O intervalo configurado controla a cadência entre os envios de comandos. Um intervalo `0` significa disparar o próximo comando assim que o envio anterior terminar; `1` significa aguardar um segundo depois do envio anterior, sem criar coordenadas artificiais nem sobrepor envios do mesmo dispositivo.

O campo de espera manual controla apenas por quanto tempo a requisição HTTP de **Localizar agora** aguarda uma observação antes de devolver o controle ao operador. Esse prazo não cancela o comando que está sendo enviado ao Google. Se a observação chegar depois, a correlação FCM continua ativa e a interface é atualizada pelo canal realtime.

O envio do comando possui um prazo técnico independente, `FINDHUB_COMMAND_TIMEOUT_MS` (30 segundos por padrão). Esse limite evita uma chamada de rede pendurada e não representa frequência de GPS.

Uma localização manual pode ser solicitada enquanto o rastreamento de fundo estiver ativo. Duas solicitações manuais simultâneas para o mesmo dispositivo compartilham a mesma operação em andamento em vez de produzir o erro “Uma localização deste dispositivo já está em andamento”.

Para decidir se uma observação deve avançar a posição exibida, o runtime considera primeiro o timestamp enviado pelo Google. Quando o timestamp é igual, uma mudança material de coordenadas, altitude, precisão ou localização semântica pode representar um refinamento válido. Mudanças apenas no tipo do relatório (`RECENT`/`NETWORK`) não transformam o mesmo ponto em uma posição nova.

Essa arquitetura remove bloqueios internos da Connect|API e garante entrega imediata de toda observação válida recebida. Ela não inventa uma garantia que o protocolo upstream não oferece: o intervalo entre novas coordenadas produzidas pelo aparelho/Google continua dependendo do serviço e do dispositivo.
