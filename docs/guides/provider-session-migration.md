# Conversão de sessão WhatsApp entre providers

O Connect|API pode converter uma instância já pareada entre `WHATSAPP-BAILEYS` e `WHATSAPP-ZAPO` sem criar uma segunda instância pública e sem manter os dois clientes de protocolo ativos ao mesmo tempo.

## Endpoint

```http
POST /instance/migrateProvider/{instanceName}
apikey: <API_KEY ou token autorizado>
Content-Type: application/json
```

Baileys → Zapo:

```json
{
  "targetProvider": "WHATSAPP-ZAPO"
}
```

Zapo → Baileys:

```json
{
  "targetProvider": "WHATSAPP-BAILEYS"
}
```

Para validar a conversão e consultar as perdas reportadas pelo migrador sem interromper o provider atual:

```json
{
  "targetProvider": "WHATSAPP-ZAPO",
  "dryRun": true
}
```

## Segurança do handoff

A migração mantém `instanceId`, `instanceName`, token, webhooks e demais configurações da instância. Antes do corte é executado um preflight do snapshot. No corte real o provider de origem é fechado **sem logout**, um novo snapshot é capturado com a sessão já estabilizada, o estado é convertido e somente então o provider de destino é iniciado.

O destino precisa atingir `open` sem apresentar QR Code nem código de pareamento. Caso isso não aconteça, o Connect|API restaura o snapshot anterior do destino, mantém o snapshot original da origem e tenta religar o provider anterior.

A resposta nunca devolve `creds`, Signal keys, sender keys ou qualquer outro segredo do snapshot.

## Armazenamento suportado

A conversão Baileys suporta o armazenamento interno já usado pelo Connect|API em PostgreSQL/arquivos e Redis. Quando `PROVIDER_SESSION` externo está habilitado, a migração é bloqueada porque o serviço de arquivos atual não possui uma operação para enumerar todas as chaves da sessão. Isso evita gerar um backup incompleto.

O Zapo usa o store PostgreSQL configurado pelo próprio provider e o mesmo `ZAPO_STORE_TABLE_PREFIX` da execução normal.

## Perdas de conversão

A conversão usa `wa-store-migrate` e retorna o campo `losses` quando há diferenças de representação entre os providers. Perdas marcadas como fatais impedem o corte. Avisos não fatais ficam visíveis na resposta para auditoria.

## Observação sobre chamadas

Esta implementação **não** cria um Zapo auxiliar para uma instância Baileys e não executa os dois providers em paralelo. Calls/voice continuam sendo capability nativa de uma instância Zapo. O objetivo desta etapa é permitir trocar o provider da mesma sessão com rollback controlado.
