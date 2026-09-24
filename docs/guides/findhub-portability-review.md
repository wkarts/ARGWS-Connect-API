# Find Hub — correção de portabilidade do receptor e da localização

Base: `develop` após a PR #131, commit `bc7d61a066e6859634c867beb6a56c57e9b87097`.
Esta correção não altera o login Google nem a extensão. Também não modifica motores WhatsApp/Baileys/ZAPO/Meta, configurações desses canais, dependências, migrations, deploys ou retenção/canonização de imagens.

## Referência efetivamente analisada

Arquivo fornecido pelo operador: `GoogleFindMyTools-main(2).zip`.
SHA-256: `1c3d09e1a7739cde0f7d10912f6e6041d16de596bccb16dfaf194872f5367b55`.
A comparação usa esse snapshot, não uma versão presumida da biblioteca. Nenhum código Python, fork ou dependência da referência passa a executar na aplicação.

| Caminho na referência | Resultado da comparação |
| --- | --- |
| `NovaApi/ExecuteAction/nbe_execute_action.py` e `LocateTracker/location_request.py` | O comando Nova TypeScript já produz os mesmos bytes, com identificadores determinísticos de teste. Não foi inventado nem acrescentado um flag de realtime. |
| `NovaApi/ExecuteAction/LocateTracker/decrypt_locations.py` | A escolha GCM/EAX depende de `publicKeyRandom` vazio, não do metadado `isOwnReport`. O campo `deviceTimeOffset` é passado diretamente ao derivador, sem subtraí-lo do horário Unix do relatório. |
| `FMDNCrypto/eid_generator.py` e `foreign_tracker_cryptor.py` | Derivação do escalar e da chave de rede conferidas; representação do escalar corrigida para suportar o tamanho da ordem da curva sem truncar hexadecimal de comprimento ímpar. |
| `Auth/firebase_messaging/fcmpushclient.py` | A referência monitora conexão ociosa e reconecta quando não há tráfego após heartbeat. O cliente TypeScript só respondia a pings recebidos. |
| `NovaApi/ExecuteAction/LocateTracker/location_request.py` e receptor FCM | O callback não é equivalente a uma resposta HTTP síncrona. Na Connect, expirar/remover o waiter também descartava pushes posteriores correlacionados. |
| `ProtoDecoders/Common.proto` e `DeviceUpdate.proto` | Preservados status, pareamento relatório/timestamp, campos zero omitidos pelo proto3 e altitude int32 negativa. |

A referência consulta localizações e aguarda callback. Ela não demonstra um contrato de GPS contínuo com frequência garantida. A comparação do código não prova que qualquer conta/aparelho responderá a cada segundo.

## Defeitos corrigidos

### Descriptografia de relatórios de rede

A segunda subchave CMAC era gerada aplicando AES com K1 como chave. Agora ela é obtida dobrando K1 em GF(2^128), com redução quando necessária. A regra também pode ser conferida na seção 2.3 do RFC 4493: <https://www.rfc-editor.org/rfc/rfc4493.html#section-2.3>.

Isso corrige a autenticação AES-EAX dos relatórios com bloco parcial. Também foram corrigidos o uso de `deviceTimeOffset`, a escolha do algoritmo pelo campo `publicKeyRandom`, a representação do escalar e a comparação constante da tag. AES-GCM e o fluxo de obtenção das credenciais permanecem preservados.

O parser não atribui a um relatório de rede sem timestamp o horário do relatório recente. Latitude/longitude zero e altitude negativa são decodificadas conforme os tipos protobuf. A origem reflete LAST_KNOWN, CROWDSOURCED ou AGGREGATED quando informada; isso não é inferência de aparelho online.

### Recebimento contínuo separado do prazo HTTP

O deadline do operador continua encerrando a solicitação HTTP. Não é estendido silenciosamente. Entretanto, enquanto o rastreamento estiver ativo, relatórios FCM válidos de um comando conhecido podem continuar atualizando o dispositivo após a conclusão ou expiração dessa solicitação.

A correlação é limitada a 512 comandos por conta e cinco minutos, com até 128 fingerprints por comando. Não são aceitos UUIDs desconhecidos. A identidade do aparelho é conferida quando presente nos metadados; a chave criptográfica e a associação autorizada da solicitação continuam necessárias. O contexto retido contém apenas IDs, não avatar ou credenciais. Parar o rastreamento remove contextos não pendentes e o runtime recusa novas entregas tardias para dispositivo não rastreado; desconectar elimina todos os contextos.

Persistência e emissão compartilham uma fila por dispositivo para impedir duplicação entre o callback e o retorno HTTP. Um relatório novo é emitido para o SSE já existente, histórico e Traccar. Relatórios anteriores não fazem a posição ao vivo retroceder. Nenhum timestamp ou movimento é simulado.

Uma consulta que expirou permanece diagnosticada como timeout, mesmo que depois chegue uma posição. O Manager distingue essa entrega posterior e remove a mensagem de falha em primeiro plano quando chega uma observação mais nova, sem renomear a consulta expirada como bem-sucedida.

### Conexão FCM silenciosa

Após 20 segundos sem tráfego, o receptor envia heartbeat. Sem tráfego/ACK por mais cinco segundos, deixa de se declarar pronto e encerra o socket, usando o mecanismo existente de reconexão com as mesmas credenciais. Os temporizadores são removidos ao parar/desconectar. A página continua atualizando pelos eventos da aplicação, não por um contador visual.

### Ícone do canal

`ChannelsView` utiliza o ícone de localização para Google Find Hub. A condição e o ícone de WhatsApp permanecem idênticos.

## Evidência e testes

`test/fixtures/findhub-port-vectors.json` contém exclusivamente chaves, identidades e coordenadas sintéticas. Os bytes da requisição foram gerados pelas funções originais do snapshot anexado; os relatórios usam seus protobufs e a função original `calculate_r`, com uma implementação independente baseada em Python cryptography CMAC/AES-CTR e primitivas EC OpenSSL. A referência completa não foi executada contra o Google. A aplicação não ganha dependências por causa dos vetores.

Os testes exercitam protobuf real, envelope de chave, AES-EAX, AES-GCM, entrega tardia ao runtime/histórico/SSE, status, rejeição de adulteração, deduplicação, isolamento, limites da correlação e heartbeat. Na reprodução local, 14 dos 75 testes falham com as fontes anteriores e os 75 passam com a correção. A suíte do Manager valida coordenadas recebidas após timeout sem transformar o timeout em sucesso.

O diagnóstico fornecido contém 447 eventos mais o cabeçalho. Há 11 respostas HTTP 500 de uma rota anonimizada e 12 eventos runtime.error, mas não há payload FCM, UUID ou motivo remoto suficiente para atribuir cada falha a uma dessas divergências. Esse log não foi incluído no repositório. As falhas de portabilidade acima são reproduzidas pelos testes, não presumidas a partir de uma mensagem genérica de timeout.

## Limites e implantação

A instalação exige atualizar API e Manager para a imagem que incorporar a correção. Não é necessário atualizar a extensão, refazer login, regenerar chaves ou apagar histórico/volumes.

Intervalo e timeout continuam sob controle do operador. Em particular, timeout de 1 ms pode abortar o envio antes de o comando chegar ao Google. A correção não faz uma requisição não enviada produzir dados; ela impede descartar uma resposta válida que de fato chegou e corrige sua descriptografia. Um ponto antigo continua identificado pelo seu horário original. Autenticação, saúde do socket e idade da localização são condições diferentes.

Testes automatizados com vetores independentes não substituem homologação de GPS com aparelho físico em movimento. Não houve acesso à conta Google, alteração do smartphone ou teste real de movimento durante esta implementação.
