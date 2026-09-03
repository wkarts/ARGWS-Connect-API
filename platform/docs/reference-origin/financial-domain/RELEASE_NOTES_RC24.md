# Release Notes — v1.0.0-rc.24

A rc.24 evolui dois pontos centrais da plataforma: a administração da landing page pública e a convergência definitiva do WhatsApp do tenant com a integração gerenciada pelo Control Plane.

## Landing Page Builder

O Control Plane recebe um editor dedicado em `/landing-builder`, reutilizável como motor para futuras landing pages de tenants.

Recursos:

- biblioteca de blocos: hero, texto, benefícios, planos, imagem, galeria, CTA, divisor, espaçador e HTML avançado;
- inserção e reordenação por drag-and-drop;
- árvore estrutural de blocos;
- duplicação, exclusão e movimentação de blocos;
- edição visual de conteúdo, estilos, tema e metadados da página;
- HTML personalizado sem JavaScript arbitrário;
- CSS personalizado com preview em tempo real;
- preview isolado em desktop, tablet e celular;
- undo/redo local;
- rascunho separado da versão publicada;
- checkpoints/versionamento;
- restauração de versão no rascunho;
- publicação explícita;
- habilitação/desabilitação da página pública;
- planos públicos carregados dinamicamente do Control Plane;
- migração inicial da antiga configuração `PUBLIC.LANDING`;
- auditoria de save, checkpoint, restore, publish e mudança de estado.

O documento da landing é persistido como estrutura JSONB versionada. Isso permite reutilizar o mesmo editor posteriormente em páginas públicas dos tenants sem duplicar o motor visual.

## Segurança do editor

- HTML remove `script`, `iframe`, `object`, `embed`, handlers `on*` e protocolos `javascript:`/`vbscript:`;
- CSS personalizado bloqueia expressões e protocolos executáveis;
- limite de tamanho do documento, CSS e quantidade de blocos;
- publicação usa somente a versão saneada;
- detalhes administrativos e infraestrutura não fazem parte do contrato público.

## WhatsApp gerenciado do tenant

Os logs de produção mostraram dois caminhos diferentes antes desta release:

- Control Plane enviando pela instância exclusiva do tenant e recebendo sucesso;
- fluxo de notificações do tenant caindo no identificador legado/global `financial-platform` e recebendo HTTP 404.

Na rc.24 o WhatsApp fornecido pela plataforma passa a ser a fonte de verdade também para o `NotificationService` do tenant:

- lifecycle/pareamento continuam disponíveis ao próprio tenant;
- credencial mestre da Evolution permanece somente no Control Plane/plataforma;
- envio do tenant usa a mesma instância exclusiva resolvida por `managed_whatsapp(context)`;
- uma `IntegrationSetting` antiga chamada `EVOLUTION` não sobrescreve mais silenciosamente a instância gerenciada;
- infraestrutura Evolution própria do tenant só substitui a plataforma quando declarar explicitamente `delivery_mode=EXTERNAL`;
- destino continua normalizado com DDI 55 e DDD da empresa emissora;
- falhas continuam registradas na observabilidade com dados sanitizados.

## Compatibilidade

A configuração externa permanece suportada para clientes autorizados pelo plano. O comportamento padrão, porém, é sempre usar o serviço WhatsApp gerenciado da plataforma e a instância exclusiva do tenant.

## Versão

`1.0.0-rc.24`
