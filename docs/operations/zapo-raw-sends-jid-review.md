# Revisão dos guias ZAPO: envios brutos e JIDs

Base consultada: https://zapo.to/pt-br/guides/raw-sends e https://zapo.to/pt-br/reference/jid-helpers, comparadas aos exports e código da dependência fixada @innovatorssoft/zapo-js 1.6.3.

## Conteúdo bruto não depende de builder tipado

O guia documenta client.message.send(jid, Proto.IMessage), incluindo productMessage, orderMessage, contactsArrayMessage, interactiveMessage e requestPhoneNumberMessage. A ausência de um builder tipado não significa ausência de transporte. Produto requer productImage previamente enviado quando a imagem é utilizada. priceAmount1000 e totalAmount1000 usam milésimos; pagamentos native-flow usam value/offset, conforme o guia. Não intercambiar essas unidades.

Essa superfície envia mensagens. Não documenta uma consulta de catálogo, paginação ou CRUD de produtos. Na PR 77 a leitura de produtos/coleções continua no plugin connect-commerce pela interface pública queryWithContext, sem outra sessão ou troca de dependências. businessCatalog: true descreve essa leitura; não anuncia novas rotas REST de envio bruto ou CRUD. Testes do codec não comprovam renderização mobile/Web nem homologação de catálogo real.

## Correção de grupos

O detector do adaptador utiliza getContentType da raiz pública do ZAPO. Uma senderKeyDistributionMessage junto de imagem, áudio, documento ou texto estendido não pode ocultar o conteúdo da mensagem de grupo. Envelopes contendo somente sender-key mantêm a classificação interna, sem virarem conversas. A carga original e participant/remoteJid não são reescritos por essa detecção.

## Identificadores

normalizeRecipientJid, toUserJid e os classificadores oficiais permanecem a fonte de semântica. Grupo @g.us, LID @lid, canal @newsletter e status@broadcast não são números de telefone. Campo explicitamente tipado como LID aceita dígitos puros; texto misturado não é limpo para fabricar um LID. O aprendizado PN/LID continua dependendo de vínculo explícito; os helpers não consultam agenda, nome ou foto.

requestPhoneNumberMessage é uma mensagem de solicitação. Não há nesse guia promessa de conversão automática LID para PN. Esta correção não a envia silenciosamente durante chamadas ou resolução de contatos.

## Validação

Regressões executam o corpo do detector de produção com o SDK real instalado e os helpers reais, sem parear WhatsApp. Incluem conteúdo de grupo com sender-key, metadados, produto/pedido, preservação de namespaces, rejeição de LIDs fabricados e valores de codec. Não há alteração de rotas, schema, migrations, credenciais, nomes ou sessões.
