# Connect|API Find Hub Auth — extensão opcional

ID estável: `dcnejnlafhanlldafkijledmonimkgng`. Versão 0.1.7.

Esta é uma implementação experimental própria para Chrome/Edge desktop, não um login OAuth público Google. Extraia o ZIP servido pela sua API e use Carregar sem compactação na página de extensões (modo desenvolvedor). Volte ao Manager e inicie Conectar conta. A janela **da extensão** mostra a origem solicitante, o servidor destinatário e a conta: aprove somente destinos de sua confiança.

`externally_connectable` aceita páginas self-hosted; isso não concede acesso a cookies. As permissões opcionais ficam limitadas a `accounts.google.com` e `myaccount.google.com`, solicitadas na janela de consentimento. O segundo domínio é usado apenas para observar o retorno da navegação de login, sem ler conteúdo da página. Nenhum site recebe artefatos sem autorização explícita por tentativa. O canal original permanece aberto; fechar a interface ou a aba Google cancela. Não usa armazenamento, analytics, VNC, servidor intermediário, debugger ou senha Google.

O protocolo privado pode entregar credenciais Google de alcance amplo. Tokens não são exibidos ou copiados manualmente e não devem aparecer nos logs. A página destinatária já autorizada recebe os artefatos e os envia ao backend próprio por HTTPS. XSS nessa página comprometeria os dados; não vincule contas em instalações não confiáveis.

**Limites:** sem homologação com conta Google real; desafios/restrições do Google podem impedir o fluxo. Não instala aplicativos no smartphone rastreado, mas exige esta extensão no navegador usado para vincular. Chrome Android, Safari iOS e Firefox não são suportados por esta implementação. Não substitui um futuro fluxo puramente web/mobile. Não coletar PIN, senha, captcha ou passkey.

## Atualização 0.1.1

Substitua o conteúdo da pasta da extensão já instalada, clique em **Recarregar** em `chrome://extensions` (ou `edge://extensions`) e recarregue o Manager. O ID não mudou. A API também precisa da correção desta versão; trocar somente a extensão não corrige a troca de credenciais no servidor. Não reutilize a sessão anterior.

O ícone é a imagem oficial fornecida pelo proprietário, apenas redimensionada para 16/32/48/128 px, mantendo fundo, desenho e proporções. SHA-256 do PNG 1024 original: `6968e17ff8f88417d50c88b5082008ecfb93cad840834c6dc9e034e2f6709926`.

A leitura do artefato é repetida após a abertura e carregamento da aba autorizada para não perder respostas rápidas. Continua exigindo consentimento, foco, origem correta e uma tentativa ativa. Nenhum cookie preexistente da tentativa anterior é reenviado.

### Distribuição 0.1.2

O instalador Windows `Connect-FindHub-Auth-Setup-0.1.2.exe` e o ZIP são publicados juntos, com `SHA256SUMS.txt` e `extension-release.json`. O EXE instala/atualiza arquivos por usuário, sem administrador, em `%LOCALAPPDATA%\ARGWS\ConnectFindHubAuth\extension`. A ativação inicial (`Carregar sem compactação`) e o `Recarregar` após atualizar permanecem sob controle do navegador. Não são alteradas políticas/perfis para forçar instalação. O EXE não é assinado; não desative proteções de segurança para executá-lo.

O ID do helper e os ícones oficiais foram preservados. API/Manager 0.1.2 do fluxo prepara uma identidade Google FCM real antes do login e informa o contexto categórico de falhas, sem divulgar segredos. A versão da aplicação e a versão do helper são independentes. Consulte o commit em `extension-release.json` antes de misturar builds.

### 0.1.3 — Assistente Windows Rust

O release disponibiliza ZIP, instalador NSIS e assistente Rust Windows x64, com a mesma identidade e ícones canônicos. Consulte `windows-assistant/README.md` no repositório. O assistente apenas prepara/atualiza os arquivos e ajuda a abrir o gerenciamento de extensões: aprovação inicial e recarregamento permanecem no navegador. Não altera políticas nem perfis; não acessa a conta Google.

O backend correspondente preserva os bytes opacos do cookie sem decodificação URI adicional e diferencia motivos conhecidos de rejeição. A nova versão não representa uma homologação automática do login real.

### 0.1.4 — Troca de autenticação e confirmação das mensagens

Atualize a API/Manager e o helper juntos. O comando de aprovação agora é confirmado antes de abrir outra aba; conclusão e erros continuam no canal vinculado à sessão. Cancelar ou receber uma falha rápida do servidor não deixa `sendResponse` pendente. Aceitar o comando não significa aceitar a conta Google.

No backend, o formulário de troca segue o perfil de interoperabilidade de `gpsoauth` 2.0.0, sem instalar essa biblioteca. O marcador legado `droidguard_results=dummy123` não é uma prova de integridade. Uma exigência real do Google permanece uma falha, sem reenvio do token, bypass ou alteração de TLS. `MissingDroidguard` é classificado como `[FH-AUTH-9116]`, não `UNCLASSIFIED`.

O login real continua sujeito à homologação pelo operador. A ocorrência de `message channel closed` em outra página/extensão, por si só, não comprova a causa de um HTTP 400 no backend. Preserve a chave da instalação e comece uma nova tentativa após atualizar ambos os lados.

### 0.1.6 — Retorno do desbloqueio Google

Corrige o callback após o redirecionamento para `/v3/signin/challenge/kls` com
`flowName=EncryptionUnlockAndroid` e o contexto exato da tentativa. Os dois scripts
`vault-page.js` e `vault-relay.js` entram em `document_start`, somente durante a
vinculação consentida. Origem, aba, documento, frame e nonce são verificados.
Não há leitura de campos de PIN/senha nem alteração de CORS/TLS.

`#close`/`closeView` sem chave gera `FH-EXT-VAULT-NOKEY`, nunca sucesso de login.
Atualize/recarregue a extensão e inicie novamente; o contrato da API 0.1.4 é
compatível com esta correção. O PIN é o bloqueio do aparelho escolhido e deve ser
digitado apenas na página Google, nunca enviado em capturas/logs.

## Correção 0.1.6 — confirmação de preparo e entrega do retorno

O vínculo de um documento (`VAULT_BIND`) apenas autoriza o relay. A extensão só
considera o callback preparado depois da confirmação `BOUND` do script MAIN e
da confirmação `VAULT_READY` pelo worker. Um documento redirecionado precisa
concluir seu próprio preparo. Se isso não acontecer em 30 segundos, a tentativa
é encerrada com `FH-EXT-VAULT-BRIDGE`, sem aguardar silenciosamente a expiração.

Falhas na entrega da chave deixam de ser ignoradas. A extensão exige resposta
positiva do worker; uma recusa encerra a tentativa com `FH-EXT-VAULT-DELIVERY`.
Nenhuma chave ou credencial é reenviada automaticamente. Se a chave já foi aceita
para verificação no backend, uma confirmação perdida não cancela essa verificação.
Mensagens de erro transportam apenas uma categoria fixa, nunca PIN, senha ou chave.

Atualize os arquivos da mesma pasta e clique em **Recarregar** na página de
extensões antes de iniciar uma tentativa nova. O contrato REST não mudou: uma API
com o fluxo browser-auth da PR #125 é compatível. A PR #126 também atualiza o ZIP
servido pelo Manager e sua indicação de versão. Não altere CORS, TLS ou a chave
`FINDHUB_CREDENTIALS_KEY`. Testes controlados não comprovam login Google real.


## 0.1.7 — Sessão web antes do desbloqueio e erro Google explícito

Esta revisão é uma correção candidata, testada localmente com respostas controladas.
Não é uma homologação de autenticação real nem afirma que um erro 401 específico do
Google tenha sido eliminado. Não modifica o pedido inicial de token no backend.

O resultado do login nativo `EmbeddedSetup` é trocado pela API como anteriormente.
Antes de abrir o endereço do cofre recebido da API, a extensão conduz a **mesma aba
consentida** pelo login web oficial do Google, com retorno fixo a
`https://myaccount.google.com/`. Ela aguarda uma navegação concluída nessa aba;
origens parecidas, `/intro`, outras abas ou navegação pendente não liberam o cofre.
Chegar à página da conta é somente uma etapa de navegação: a API ainda precisa
validar a chave e a conexão para declarar a vinculação concluída.

A permissão adicional para `myaccount.google.com` permite consultar endereço e
estado dessa aba. O código não injeta scripts nem lê conteúdo, formulários ou
cookies desse domínio. A autorização do navegador continua sendo explícita.
Os callbacks continuam limitados ao `kdi`, nonce, aba e documento da tentativa.
Não há captura de PIN, senha, desafio de segurança ou resposta da notificação.

O Google pode solicitar confirmação em duas etapas e, depois, o bloqueio de tela
do aparelho. A extensão não escolhe nem substitui esses fatores. Uma página de
confirmação normal sem o contexto do cofre não ganha autorização para entregar
chaves, e a espera pela ação do usuário não é confundida com o prazo de preparo
do callback. O limite global de expiração permanece.

Uma página de erro Google no cofre, com título padronizado de erro 4xx/5xx, encerra
a espera com `FH-EXT-GOOGLE-HTTP`. A extensão consulta apenas o título fornecido
pelo navegador, não o HTML ou a resposta bruta. Não tenta repetir a URL, falsificar
cookies, alterar cabeçalhos de segurança ou contornar a exigência do Google.

### Aplicação

1. Cancele a tentativa antiga e feche apenas as abas abertas por ela.
2. Extraia o ZIP 0.1.7 na mesma pasta de sua extensão, preservando o perfil do navegador.
3. Clique em **Recarregar** na página de extensões e recarregue o Manager.
4. Inicie uma vinculação nova e confira os dois destinos Google na autorização.
5. Conclua os fatores que o próprio Google oferecer, sem compartilhar códigos, PIN
   ou URLs de sessão. Não continue repetindo uma notificação já expirada.

O contrato REST continua compatível com o browser-auth existente da PR #125 em
diante. Uma interface anterior exibirá instrução genérica de login; o componente
Manager desta revisão diferencia a etapa web e o desbloqueio. O instalador 0.1.6
antigo não deve ser executado por cima destes arquivos, pois os substituiria pelos
arquivos daquela versão. Nenhum binário Windows 0.1.7 foi compilado nesta entrega local.

Falha `FH-AUTH-9114` ocorre **antes** do login, no registro Google do receptor feito
pelo servidor. Este ZIP não resolve essa falha de backend; os logs anteriores não
contêm a etapa remota e o motivo originais. `FH-AUTH-9110` indica uma tentativa que
já não pode ser utilizada. Reiniciar a API elimina suas tentativas em memória;
sempre inicie outra vinculação após uma atualização/reinício do servidor.

Não regenere `FINDHUB_CREDENTIALS_KEY`, não apague volumes e não faça downgrade da
API inteira. A preservação das credenciais já cifradas exige conservar sua chave.
