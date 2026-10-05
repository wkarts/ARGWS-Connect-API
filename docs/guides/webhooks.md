# Webhooks por instância

## Como recuperar o envio quando o receptor retorna 404

Em **Instâncias → Configurações da instância → Webhooks**, confira a URL e a opção **Adicionar evento à URL**. Se o receptor Laravel registra uma rota `POST /whatsapp/ponto/webhook/messages-upsert`, configure a URL base `/whatsapp/ponto/webhook` e **ative** essa opção. Se ele registra somente `POST /whatsapp/ponto/webhook`, **desative** a opção. Salve e acompanhe uma mensagem nova no diagnóstico. Não é preciso reiniciar a conexão WhatsApp.

`messages.upsert` vira `/messages-upsert` quando a opção está ativa. O nome do evento também permanece em `event` no corpo JSON. Um HTTP 404 significa que o servidor de destino respondeu “rota não encontrada”; reconectar a instância não cria essa rota. Revise a rota, o método POST, prefixos, proxy e autenticação no sistema receptor. HTTP 400/401/403/404/422 não são repetidos automaticamente. Entregas já rejeitadas não são reproduzidas ao salvar a configuração; consulte o histórico de mensagens e reconcilie os eventos que faltarem no seu sistema.

O diagnóstico técnico registra apenas o hash do destino, evento, tentativa e código HTTP. Ele não contém a URL nem o conteúdo das conversas. O log do receptor pode conter dados pessoais: compartilhe apenas trechos redigidos.

## Configuração no Manager

O **destino principal** mantém a configuração existente. Use **Adicionar destino** para cadastrar até dez receptores adicionais. Cada destino possui nome, URL, ativação, cabeçalhos, opção de sufixo por evento e sua própria lista de eventos. É possível desativar o principal e deixar um adicional ativo. O mesmo evento é enviado em paralelo a todos os destinos ativos que o selecionaram: uma falha do principal não impede o adicional. Isso é distribuição para vários destinos, não troca automática para um endereço reserva. Desative um destino para interromper seu envio ou remova-o e salve para apagar sua configuração.

Uma seleção vazia de eventos significa **todos**. O envio de mídia codificada é uma escolha única por instância, aplicada ao payload enviado para todos os destinos. Cabeçalhos são independentes por destino. Um cabeçalho `jwt_key` gera `Authorization: Bearer <JWT>` para aquele destino; mantenha suas credenciais protegidas.

Antes de ativar um destino, confirme que o receptor aceita POST na rota exata e retorna um código HTTP 2xx. Se selecionar **Adicionar evento à URL**, confirme rotas separadas como `/messages-upsert`; caso contrário, todos os eventos chegam na URL informada. O endpoint deve tolerar entregas repetidas (use o ID real do evento/mensagem como chave quando aplicável), pois erros transitórios podem ser repetidos.

## API nativa

`GET /webhook/find/{instanceName}` retorna a configuração persistida, inclusive cabeçalhos sensíveis. `POST /webhook/set/{instanceName}` salva o objeto `webhook`. Ambos usam `apikey` da instância ou da instalação. A atualização legada que omite `additionalTargets` **preserva** os adicionais existentes; enviar `additionalTargets: []` remove todos eles.

```json
{
  "webhook": {
    "enabled": true,
    "url": "https://principal.exemplo.com/whatsapp/webhook",
    "byEvents": true,
    "base64": false,
    "headers": {},
    "events": ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
    "additionalTargets": [
      {
        "name": "Sistema alternativo",
        "enabled": true,
        "url": "https://alternativo.exemplo.com/hooks/whatsapp",
        "byEvents": false,
        "headers": { "X-Source": "connect" },
        "events": ["MESSAGES_UPSERT"]
      }
    ]
  }
}
```

URLs ativas devem usar HTTP ou HTTPS. Até dez destinos adicionais são aceitos. `byEvents`, `base64` e `events` do principal continuam compatíveis com clientes antigos; o armazenamento responde com os nomes `webhookByEvents` e `webhookBase64`. Os adicionais usam `byEvents`. Para criar uma configuração somente com destinos adicionais, envie `enabled: false` e `url: ""` para o principal.

## Evidência do incidente em 05/10/2026

No diagnóstico fornecido, o mesmo destino recebeu `MESSAGES_UPSERT` com HTTP 200 quando a URL terminava em `/messages-upsert` às 19:37 UTC. Houve `POST /webhook/set` às 19:41 UTC. A partir de 19:42 UTC, a URL base sem o sufixo retornou 73 respostas 404 e uma 500 no período exportado. O log Laravel registra as duas mensagens recebidas às 16:37 e 16:38 no horário do servidor, coerentes com as duas entregas 200. A conexão voltou ao estado `open` após um restart, mas os 404 continuaram. A falha observada era a rota de entrega, não a sessão WhatsApp. Antes desta correção, o Manager ignorava `webhookByEvents` ao carregar e enviava `byEvents: false` ao salvar, mesmo que a opção estivesse ativa.
