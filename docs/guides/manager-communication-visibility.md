# Visibilidade da comunicação e envio de teste por instância

## Objetivo e limite de segurança

O Manager pode ocultar Conversas, Mensagens e Contatos em produção, mantendo as telas
habilitáveis por ENV. O mesmo código atende desenvolvimento e produção. Não existe
bloqueio por nome de branch: o administrador decide os valores da instalação.

As flags ocultam a navegação e impedem a abertura direta das respectivas rotas do
Manager. Elas **não substituem autorização de API ou perfis de usuário**. As rotas
nativas continuam disponíveis para clientes devidamente autenticados; quem possui
uma credencial com acesso aos dados ainda pode consultá-los diretamente. Não entregar
uma chave global a usuários que não devem ter poderes administrativos. Esta mudança
não implementa RBAC novo nem altera os guards existentes.

## Variáveis

| ENV | Runtime | Produção | Develop/homologação |
|---|---|---|---|
| `MANAGER_FEATURE_CONVERSATIONS` | `conversations` | `false` | `true` |
| `MANAGER_FEATURE_MESSAGES` | `messages` | `false` | `true` |
| `MANAGER_FEATURE_CONTACTS` | `contacts` | `false` | `true` |
| `MANAGER_FEATURE_INSTANCE_TEST_MESSAGE` | `instanceTestMessage` | `true` | `true` |
| `MANAGER_FEATURE_TEST_MESSAGE_CONTACTS` | `testMessageContacts` | `false` | `true` |

Exemplo de produção, sem histórico ou agenda no Manager, com envio digitado:

```env
MANAGER_FEATURE_CONVERSATIONS=false
MANAGER_FEATURE_MESSAGES=false
MANAGER_FEATURE_CONTACTS=false
MANAGER_FEATURE_INSTANCE_TEST_MESSAGE=true
MANAGER_FEATURE_TEST_MESSAGE_CONTACTS=false
```

Para liberar a seleção de contato no modal, sem liberar as telas completas:

```env
MANAGER_FEATURE_TEST_MESSAGE_CONTACTS=true
```

Essa última opção expõe intencionalmente uma página de **nomes e identificadores da
agenda** ao operador que a solicitar. Deve permanecer `false` onde até essa exposição
não for desejada. Não depende da flag da tela Contatos. Permissões existentes também
são consideradas: `messages.send` no envio e `messages.read` no seletor.

Para reabrir uma das telas em produção, basta colocar sua variável em `true`.
`false`, `0`, `off` e `no` desabilitam; `true`, `1`, `on` e `yes` habilitam. Sem valor,
o runtime da API mantém as três telas de comunicação desabilitadas. Os Compose de
develop e homologação fornecem seus defaults explícitos. Valores explícitos no `.env`
têm precedência sobre esses defaults, inclusive um `false` em desenvolvimento.

As flags existentes de Voz, Ramais, Filas, Fluxos, Automações, DOCs e administração
continuam disponíveis. O registro comum fica em `src/config/manager-features.config.ts`.
Uma nova tela deve registrar sua ENV e vincular a mesma feature ao item de menu e ao
`meta.feature` da rota, sem criar controles específicos de um consumidor.

## Deployments e atualização

Os sete Compose ativos e seus modelos de ambiente foram alinhados pelo gerador
`scripts/sync-operations-deployments.py`. O agente operacional não foi redesenhado.
O deployment canonical 1.0.21 e as stacks somente DOCs permanecem intactos.

```bash
python3 scripts/sync-operations-deployments.py --check
```

A API injeta as flags em `/manager/assets/runtime-config.js`. A imagem standalone do
Manager também aceita as mesmas variáveis por seu entrypoint. O Vite local oferece
defaults de desenvolvimento; `MANAGER_API_BASE_URL` aponta para a API de testes.
O arquivo de runtime não contém API keys ou o token do agente.

No Dockge/Compose, ajustar **o `.env` e os mapeamentos `environment` do serviço API**,
recriar o container com o Compose atualizado e recarregar o Manager. Um `restart`
isolado não muda variáveis de um container já criado. Caso exista um `.env` antigo
com `MANAGER_FEATURE_MESSAGES=true` ou `MANAGER_FEATURE_CONTACTS=true`, altere-o
explicitamente para `false`: a atualização não sobrescreve escolhas existentes.
A imagem standalone recebe as variáveis no próprio container do Manager.

O pacote contém fontes; ainda é necessário compilar e publicar uma imagem própria
antes de atualizar a VPS. Nenhuma imagem `latest` ou tag de release foi alterada.

## Envio de teste

O botão **Enviar teste** aparece em cada cartão de instância e na página de detalhes,
quando a feature está habilitada. Ele fica indisponível se a conexão não estiver
ativa ou não suportar mensagens. Abre um modal isolado, não a tela de conversas.

O operador digita um telefone internacional e uma mensagem de texto, com limite de
4.096 caracteres. Nenhum DDI/DDD é inventado. Alternativamente, se permitido pela
ENV, pode clicar em **Selecionar contato** e depois **Carregar contatos**. Essa ação
consulta uma página de até 50 registros pelo endpoint nativo existente. Há navegação
explícita de páginas e filtro local; não há varredura, polling ou leitura de histórico.
Somente a página solicitada fica em memória e é descartada ao fechar o modal.
Grupos e canais não entram nesse teste individual. Um LID selecionado permanece LID,
sem virar telefone; para a Meta oficial, o contato precisa ter PN conhecido.

O envio usa `POST /message/sendText/:instanceName` pela abstração atual, com a
credencial normal da sessão/instância. Não foi criado endpoint de consumidor,
webhook de teste ou bypass. Há proteção contra clique duplo, fechamento durante o
envio e resultados tardios de outra seleção. Falhas não provocam reenvio automático.
Sucesso significa solicitação aceita pela API, não garantia de entrega.

O botão não lê conversas anteriores. A tela de chamadas deixa de carregar a agenda
completa para enriquecimento local quando `MANAGER_FEATURE_CONTACTS=false`, mas
continua recebendo a identidade da chamada que o backend já fornece.

A integração oficial continua sujeita à janela de atendimento e às regras da Meta.
Esse formulário não abre janela de atendimento, não envia template silenciosamente
e não contorna erros retornados pelo provider oficial.

## Testes e homologação

```bash
npm --prefix manager run test:communication-privacy
npm --prefix manager run test
npm run test:compat
```

O primeiro comando foi adicionado à cadeia de testes do Manager. Exercita defaults,
overrides, rotas diretas, normalização de telefone/LID, seleção paginada por instância,
autorização existente e geração de configuração standalone. A homologação de interface
com navegador e da entrega real WhatsApp/Meta continua necessária antes da publicação.
