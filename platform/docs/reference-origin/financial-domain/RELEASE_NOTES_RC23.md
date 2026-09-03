# Release Notes — v1.0.0-rc.23

A `rc.23` corrige duas regressões confirmadas após o deploy da `rc.22`: a observabilidade Docker existia apenas no `compose.yaml` canônico da raiz, enquanto manifests de `deployments/` continuavam sem o agente; e o WhatsApp conseguia criar/conectar a instância, mas o envio real de mensagens falhava.

## Paridade real dos deployments

A `rc.22` introduziu `platform-log-agent` e `financial-docker-proxy` no compose canônico, porém parte do pipeline apenas injetava esses serviços durante o empacotamento Dockge. Isso permitia que os testes do pacote passassem enquanto os arquivos fonte de `deployments/` continuavam antigos.

A `rc.23` elimina essa divergência.

Os seguintes runtimes passam a conter diretamente o mesmo subsistema de observabilidade:

- `compose.yaml`;
- `deployments/docker/compose.images.yaml`;
- `deployments/production/compose.yaml`;
- `deployments/portainer/stack.yaml`;
- `deployments/dockge/compose.yaml`;
- `deployments/cloudpanel/compose.yaml`.

Todos incluem:

- `platform-log-agent`;
- `financial-docker-proxy`;
- rede interna `financial-observability`;
- `LOG_AGENT_URL=http://platform-log-agent:8091` na API;
- `INTERNAL_SERVICES_PASSWORD` dedicado;
- socket Docker montado somente no proxy e somente leitura;
- `POST=0` no proxy;
- nenhuma porta do agente ou proxy publicada no host.

Os exemplos de `.env` de Docker, Production, Portainer, Dockge e CloudPanel também passam a expor a credencial interna e a URL do agente.

A validação de paridade agora falha se qualquer deployment voltar a perder o agente, o proxy, a rede isolada ou o segredo interno. Isso impede que a mesma regressão seja mascarada pelo empacotador de release.

## WhatsApp / Evolution API

A evidência de produção mostrou uma instância reconhecida como conectada enquanto o envio retornava HTTP 404. A análise comparativa com o Scheduler Pro mostrou que a integração funcional utiliza o endpoint `/message/sendText/{instance}` com o corpo `number + textMessage.text`.

A `rc.23` passa a usar esse contrato compatível como primeira tentativa:

```json
{
  "number": "5575999999999",
  "textMessage": {
    "text": "Mensagem"
  }
}
```

Também foi adicionada recuperação segura para configuração antiga de rota:

- se um `send_text_path` customizado retornar HTTP 404, a plataforma tenta uma única vez a rota canônica `/message/sendText/{instance}`;
- se a API rejeitar explicitamente o schema com HTTP 400/422, a plataforma pode alternar para o formato moderno `number + text`;
- timeout, erro de rede após envio ou erro 5xx ambíguo não provocam alternância de payload, evitando duplicidade de mensagens.

A resposta remota continua sanitizada antes de chegar aos logs e à interface.

## Teste de envio no Control Plane

Foi corrigida uma colisão de rotas no backend.

A rota genérica anterior:

`/instances/{tenant_id}/{action}`

capturava também:

`/instances/{tenant_id}/test-message`

fazendo `test-message` ser interpretado como uma ação administrativa inválida. Isso explica a mensagem **“Ação de WhatsApp inválida.”** observada no Control Plane.

As operações administrativas agora usam um namespace não ambíguo:

`/instances/{tenant_id}/actions/{action}`

Enquanto o teste real permanece em:

`/instances/{tenant_id}/test-message`

Assim, criar, conectar, reiniciar, desconectar, remover e testar envio não disputam mais a mesma rota dinâmica.

## Regressões adicionadas

A suíte passa a verificar explicitamente:

- presença do agente e proxy em todos os manifests de produção;
- ausência de portas publicadas pelos componentes de observabilidade;
- socket Docker somente leitura;
- segredo interno dedicado;
- rede `financial-observability` interna;
- ausência de dependências `localhost` em runtime Docker;
- `.env.example` de todos os deployments com `INTERNAL_SERVICES_PASSWORD` e `LOG_AGENT_URL`;
- contrato de envio compatível com o Scheduler Pro;
- recuperação de `send_text_path` antigo em HTTP 404;
- fallback de schema apenas em rejeição explícita 400/422;
- ausência de repetição automática em falhas remotas ambíguas;
- rotas do Control Plane sem colisão entre ação e teste de mensagem.

## Atualização de ambiente existente

Preserve o `.env` atual e acrescente a credencial interna utilizando o gerador da própria aplicação:

```bash
python3 scripts/generate_secrets.py --env .env
```

Depois atualize as imagens e recrie os serviços pelo compose correspondente ao deployment utilizado.

Exemplo para o compose canônico:

```bash
docker compose --env-file .env pull
docker compose --env-file .env up -d --remove-orphans
docker compose ps
```

Em Dockge/CloudPanel, atualize o `compose.yaml` para o arquivo da `rc.23` antes de recriar a stack. O inventário deve passar a mostrar `financial-docker-proxy` e `platform-log-agent`.

## Versão

Versão canônica: `1.0.0-rc.23`.
