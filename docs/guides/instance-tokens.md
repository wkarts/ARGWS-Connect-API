# Token da instância no Manager

O cartão de cada instância apresenta uma linha discreta **Token**, abaixo do número, com as ações **Mostrar token / Ocultar token** e **Copiar token**. Nome, foto, situação, contadores, Enviar teste e Abrir permanecem no mesmo desenho. A cópia não abre a instância nem revela o token na tela; uma confirmação aparece somente após a cópia bem-sucedida.

## Acesso e origem

O recurso utiliza a API nativa já existente, `GET /instance/fetchInstances?instanceId=<id>`, com a credencial da sessão no cabeçalho `apikey`. A API mantém suas verificações existentes: a chave administrativa consulta as instâncias da instalação e uma chave de instância fica limitada às instâncias autorizadas por essa chave. Não foi criado endpoint público nem alterada a autorização do backend.

O frontend solicita o registro apenas por ação explícita, verifica se o identificador retornado corresponde ao cartão e utiliza exclusivamente o campo `token`. A chave de entrada do Manager nunca é usada como valor alternativo. Token ausente, falta de permissão, falhas de rede e sessão expirada geram mensagem, não uma credencial inventada. O token apresentado é a credencial da instância no Connect|API, não uma chave do serviço WhatsApp Business/Meta.

Disponível no adaptador nativo (`compatibility: current`), utilizado pelo Manager embarcado e pelo standalone, com sessão autenticada e acesso `instances.read` (ou `*`). O adaptador opcional `service` não expõe esses controles enquanto não disponibilizar um contrato próprio de credenciais; nenhuma rota não implementada é chamada.

## Privacidade e operação

O token começa mascarado. Mostrar revela o texto por até 30 segundos; Ocultar, Esc, perda de foco da janela, troca de aba, mudança de instância, encerramento da sessão ou saída da tela removem o valor do estado local e cancelam consultas pendentes. Respostas atrasadas não voltam a exibir o segredo. O componente não persiste o token em localStorage/sessionStorage, não acrescenta o segredo à URL e não o envia a logs. A consulta usa `cache: no-store` e espera no máximo 30 segundos.

Copiar utiliza a Clipboard API quando disponível, com compatibilidade legada como último recurso. Se o navegador bloquear ambas, a interface orienta Mostrar token e copiar manualmente; não apresenta confirmação falsa. O campo temporário é removido após a tentativa. A cópia deliberada coloca a credencial na área de transferência do sistema: o prazo de ocultação da tela não apaga essa área.

Nenhuma variável nova de ambiente, migration, reconexão, rotação de token ou alteração na configuração das instâncias é necessária. Para receber o recurso é preciso utilizar um build que contenha esta correção. Uma imagem estável anterior não é modificada pela atualização da branch develop.

## Testes

```bash
cd manager
npm run test:instance-token
npm test
```

A suíte cobre consulta autenticada e restrita à instância, ausência de fallback para a chave de entrada, erros sem vazamento de corpo da resposta, cancelamento e sessão alterada, cópia moderna/legada, descarte do segredo e preservação do cartão.
