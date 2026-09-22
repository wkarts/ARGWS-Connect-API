# Connect|API Find Hub Auth — extensão opcional

ID estável: `dcnejnlafhanlldafkijledmonimkgng`. Versão 0.1.0.

Esta é uma implementação experimental própria para Chrome/Edge desktop, não um login OAuth público Google. Extraia o ZIP servido pela sua API e use Carregar sem compactação na página de extensões (modo desenvolvedor). Volte ao Manager e inicie Conectar conta. A janela **da extensão** mostra a origem solicitante, o servidor destinatário e a conta: aprove somente destinos de sua confiança.

`externally_connectable` aceita páginas self-hosted; isso não concede acesso a cookies. A permissão opcional fica limitada a `accounts.google.com` e é solicitada na janela de consentimento. Nenhum site recebe artefatos sem autorização explícita por tentativa. O canal original permanece aberto; fechar a interface ou a aba Google cancela. Não usa armazenamento, analytics, VNC, servidor intermediário, debugger ou senha Google.

O protocolo privado pode entregar credenciais Google de alcance amplo. Tokens não são exibidos ou copiados manualmente e não devem aparecer nos logs. A página destinatária já autorizada recebe os artefatos e os envia ao backend próprio por HTTPS. XSS nessa página comprometeria os dados; não vincule contas em instalações não confiáveis.

**Limites:** sem homologação com conta Google real; desafios/restrições do Google podem impedir o fluxo. Não instala aplicativos no smartphone rastreado, mas exige esta extensão no navegador usado para vincular. Chrome Android, Safari iOS e Firefox não são suportados por esta implementação. Não substitui um futuro fluxo puramente web/mobile. Não coletar PIN, senha, captcha ou passkey.
