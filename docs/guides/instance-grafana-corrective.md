# Instâncias, Grafana e conclusão TLS — correção cumulativa

## Instâncias de clientes

O `ModalDialog` aceita `open` explícito e `v-model`. A ausência de `open` deixa de
virar `false` implicitamente e esconder as janelas de criação, adoção e pareamento.
Testes montam a página real sem substituir o componente de janela.

No modo Connect (domínio financeiro de referência desabilitado), o Control Plane
lista os mesmos `EngineBinding` do console dos clientes: cada vínculo é uma linha.
Cliente sem vínculo aparece como **Sem instância vinculada**, não como conexão
compartilhada. A leitura não descobre, adota ou cria instâncias externas. A integração
legada de notificações é preservada somente no modo de referência financeiro.

As rotas administrativas existentes continuam protegidas por roles Control Plane:
`POST /api/control/v1/whatsapp/instances/{tenant_id}/actions/{action}` e
`POST /api/control/v1/whatsapp/instances/{tenant_id}/test-message` aceitam
`binding_id`. Ele é obrigatório quando há mais de uma instância. Um vínculo de
outro cliente retorna 404. O frontend envia o ID da linha selecionada e usa o
segmento `/actions/` que já pertence ao contrato da API.

Preparar uma primeira instância utiliza a reserva, o limite contratado e a
reconciliação existentes; QR/pareamento continuam separados. Uma reserva pendente
é retomada pelo seu ID. Não existe fallback para uma instância global nem
reassociação silenciosa do Demo. Exclusão administrativa de instância adotada é
bloqueada: a desvinculação não destrutiva permanece no console do cliente.

## Grafana em TODOS os deployments que o incluem

A correção é aplicada a `deploy/platform/compose.yaml`,
`deploy/platform-develop/compose.yaml` e `deploy/platform-production/compose.yaml`.
O overlay de build local herda o serviço corrigido. Todos os demais Compose do
repositório são inventariados por teste; não recebem Grafana se não o possuíam.

O próprio serviço cria `/var/lib/grafana/dashboards` e um dashboard inicial de
saúde. O JSON inicial só é escrito quando o arquivo não existe; arquivos de usuário
são preservados. O provider utiliza `disableDeletion: true` e `allowUiUpdates: true`.
O nome/volume/porta/imagem do Grafana, dos bancos e dos dois PgBouncer permanecem
os mesmos. Não crie pasta, YAML de provider ou JSON manual no VPS.

O Control Plane aceita o token explícito `GRAFANA_SERVICE_ACCOUNT_TOKEN`, com
prioridade. Quando esse token não está definido, as stacks completas habilitam
`GRAFANA_LOCAL_ADMIN_ENABLED=true` e reutilizam `GRAFANA_ADMIN_USER` e
`GRAFANA_ADMIN_PASSWORD` já existentes no `.env`, somente para o destino interno
literal `http://connect-grafana:3000`. Não há envio dessas credenciais para um
endpoint externo nem seguimento de redirects. Grafana externo/Cloud continua
exigindo token de serviço. A opção local pode ser desabilitada no `.env`.

O painel diferencia servidor acessível de administração autenticada. Credencial
recusada não produz logout do Control Plane, sucesso fictício ou fallback de um
token inválido para a senha. Se a senha do Grafana foi alterada em seu banco,
alterar a variável de bootstrap no `.env` não a redefine: use a credencial vigente
ou um token autorizado. Não há rotação automática ou exposição de segredos.

## Provisionamento em 95%

Jobs `WAITING_TLS` podem terminar tanto para um cliente `PROVISIONING` quanto para
um já `ACTIVE`, depois de revalidar domínio, banco e storage. A data de ativação
original é preservada. Clientes suspensos/desabilitados/excluídos não são ativados
por essa rotina; jobs já encerrados também não são repetidos. Não há nova migration
nem recriação de banco/credenciais.

## Atualização e canais

Atualize a definição do Compose escolhido e as imagens correspondentes no Dockge,
preservando `.env` e volumes. O comando corrigido do Grafana está no Compose, não
é obtido só por trocar a imagem. Modais/Control Plane/TLS dependem também das imagens
novas da Platform API/Web/worker. Somente `compose.yaml` e `.env` são configuração
do operador; os arquivos internos são gerados pelos serviços.

Correção do Compose de produção em `develop` não promove imagens estáveis. Homologue
em `develop` e use o fluxo separado de promoção para `main`/release; não misture
imagens `latest` antigas e `develop`. PgBouncer não é removido.

## Validação

CI testa as janelas reais (Vue), escopo de vínculos, autenticação do Grafana e
conclusão de jobs. Uma integração descartável inicia Grafana 12.1.0 com o comando
inline, verifica autenticação/dashboard e recria o container mantendo o volume.
Isso não substitui teste WhatsApp real ou deploy no VPS do operador. Os arquivos
OpenAPI/AsyncAPI do Engine não mudam; novas opções de payload da Platform integram
seu OpenAPI automático.

Referências de comportamento: documentação oficial Vue (props Boolean/default
undefined) e Grafana (HTTP Basic/service account e provisioning disableDeletion).
