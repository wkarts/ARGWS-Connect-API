# Template Studio — Professional Workspace e Wizard

O Template Studio passa a ter dois modos complementares de trabalho:

- **Wizard de solução**: criação guiada ponta a ponta;
- **Studio**: edição detalhada, manutenção, diagnóstico e ajustes avançados.

O Wizard não é apenas um formulário de Template. Ele registra uma solução conversacional usando os contratos canônicos existentes do Connect|API.

## Fluxo do Wizard

1. **Mensagem**
   - nome canônico;
   - idioma;
   - categoria;
   - header/body/footer.

2. **Interações**
   - QUICK_REPLY;
   - URL;
   - PHONE_NUMBER;
   - COPY_CODE;
   - LIST;
   - CHOICE;
   - WHATSAPP_LOCATION;
   - captura de variável;
   - binding para Action/Recipe.

3. **Dados & APIs**
   - uma ou várias Actions REST;
   - GET/POST/PUT/PATCH/DELETE;
   - Base URL e path;
   - `credentialRef`;
   - confirmação NONE/CONFIRM/STRONG;
   - timeout;
   - rede privada configurável;
   - query/body/output mapping avançados.

4. **Fluxo**
   - Recipe opcional;
   - etapas visuais;
   - Action por etapa;
   - input por etapa;
   - `continueOnError`.

5. **Micro App / Localização**
   - Micro App opcional;
   - múltiplas páginas;
   - campos INPUT/DATE/TIME/CHECKBOX/SELECT;
   - GPS OPTIONAL/REQUIRED/REQUIRED_AUTO;
   - precisão máxima;
   - geofence;
   - Action/Recipe no submit.

6. **Revisão**
   - resumo da solução;
   - criação somente após confirmação final;
   - ordem: Actions → Recipe → Template/Interações/Micro App.

## Dois modelos de geolocalização

### WhatsApp Location

A interação `WHATSAPP_LOCATION` espera uma mensagem de localização enviada pelo usuário no WhatsApp. O Interaction Normalizer produz uma interação `location`/`live_location`, e o binding pode capturar latitude/longitude e aplicar uma `locationPolicy`.

### Micro App GPS

O Micro App usa `navigator.geolocation` conforme a permissão do navegador e pode aplicar precisão e geofence no backend.

## Studio profissional

A navegação principal é:

`Conteúdo → Interações → Dados & APIs → Fluxo → Teste → Configurações`

- botões não ficam espalhados entre Conteúdo e Interações;
- LIST/CHOICE/Micro Apps/Localização ficam na mesma área funcional;
- Actions ficam em Dados & APIs;
- Recipes ficam em Fluxo;
- JSON canônico e políticas administrativas ficam em Configurações;
- catálogo e preview podem virar drawers em resoluções menores;
- modo claro permanece padrão.

## Exclusão de templates

Templates criados pelo usuário podem ser removidos pelo Studio com confirmação interna.

Templates `SYSTEM` ou `isDefault=true` são protegidos no backend. A proteção não depende apenas da interface.

Para providers locais, quando `hsmId/templateId` é informado, a exclusão deve usar o identificador específico e não uma busca ampla pelo nome.

Para `WHATSAPP-BUSINESS`, a exclusão continua usando o mecanismo oficial do provider e o overlay local é limpo depois do sucesso remoto.

## Segurança

- o Wizard nunca recebe o segredo real de uma integração;
- `credentialRef` continua sendo resolvido pelo Action Registry;
- STRONG confirmation não é ignorada;
- o Wizard só registra definições durante as etapas; nenhuma Action é executada automaticamente;
- Micro Apps continuam usando sessão server-side e token temporário.
