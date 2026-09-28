# Find Hub Auth 0.1.7 e retenção GHCR limitada

## Vinculação

A extensão mantém a troca inicial do token e abre o login web oficial na mesma
aba autorizada antes de solicitar o desbloqueio dos dados Find Hub. Confirmação
pelo número no smartphone e PIN de bloqueio de tela são etapas distintas que o
Google pode apresentar em sequência. A extensão não escolhe, responde nem
contorna esses desafios; observa a navegação e aguarda o retorno autorizado.

A confirmação da sessão web não autentica a instância: a chave Find Hub e a
conexão ainda são verificadas no backend. O prazo técnico de preparação do
callback não deve encerrar uma confirmação em duas etapas em andamento; o prazo
global, os controles de aba, origem, documento, nonce e kdi continuam vigentes.
Não é necessário instalar aplicativo no smartphone localizado. A correção não
resolve erros de registro FCM (FH-AUTH-9114), que precedem o login.

A permissão adicional para myaccount.google.com é usada apenas para reconhecer
a conclusão do login na aba da tentativa. Não há leitura do conteúdo da conta,
PIN, senha ou resposta de confirmação.

## Instalação Windows

A distribuição inclui o assistente nativo Rust x64, o instalador por usuário,
a extensão ZIP, os metadados da fonte e SHA256SUMS. O instalador prepara/atualiza
os arquivos em `%LOCALAPPDATA%\ARGWS\ConnectFindHubAuth\extension`. A primeira
instalação exige Carregar sem compactação no navegador; atualizações exigem
Recarregar. Nunca concede permissões, modifica políticas corporativas nem
encerra sessões silenciosamente. Os binários não têm assinatura Authenticode.
Não desative proteções do Windows. Cancele a tentativa de vinculação antiga
antes de atualizar e confirme a versão 0.1.7 depois de recarregar a extensão.

Esta é uma candidata; testes automatizados não comprovam login Google real.
O ID e a identidade visual oficiais foram mantidos. Chrome/Edge desktop são os
alvos de teste; não se presume autenticação em todo navegador Chromium/mobile.

## Retenção depois da publicação

O run 35925792844 concluiu builds e manifests de API/Manager, mas o job posterior
foi cancelado pelo limite de 15 minutos. Seu relatório registra uma exclusão de
cache e 53 exclusões GHCR antes da interrupção. Não equivale a falha do merge
ou a ausência de imagens publicadas.

O inventário agora lê somente manifests por HTTPS validado, com uma autorização
por pacote, conexões persistentes, oito leitores no máximo, tamanho limitado e
verificação SHA-256 do corpo contra o digest. Não baixa layers nem segue
redirecionamentos. Metadados de tags continuam sendo obtidos integralmente e
revalidados imediatamente antes de cada exclusão, sem cache de autorização.

A execução automática tem prazo interno de 480 segundos e lote máximo de vinte
exclusões de imagens. O limite do job permanece em quinze minutos, reservando
margem para cache, verificações e upload do relatório. Ao atingir o prazo,
encerra com `deferred`, aviso e relatório; ao esgotar o lote, registra `partial`
e preserva os candidatos restantes para a próxima publicação verificada. Não
há `continue-on-error` para transformar falhas desconhecidas em sucesso. Falhas
reais são registradas e continuam reprovando a manutenção.

A ordem de exclusão remove primeiro manifests temporários que referenciam outros
manifests temporários. Assim, interromper um lote não deixa um pai remanescente
referenciando um filho removido no mesmo lote. Grafos incompletos/cíclicos,
tags alteradas, imagens recentemente atualizadas e publicação concorrente
impedem exclusão. Operação DELETE sem confirmação não é repetida cegamente.

A rotina de cache continua separada, com duas horas considerando criação e
último acesso. Imagens base, latest, develop e o acervo canônico (incluindo
1.1.3) preservam suas proteções anteriores. Não há alteração do manifesto de
canonização, de Git tags, Releases ou artefatos oficiais. O benchmark candidato
é somente leitura; não executa limpeza usando código não integrado.

Reexecutar o run antigo usa o código antigo. Depois de integrar a PR, uma nova
publicação usa a rotina corrigida. O cancelamento histórico não é reescrito.
