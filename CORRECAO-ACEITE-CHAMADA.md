# Pull Request — aceite de chamada na Connect API

## Branch

`fix/zapo-incoming-call-accept`

## Título

`fix(voip): envia aceite ao dispositivo originador da chamada`

## Descrição

### Contexto e objetivo

Atender no smartphone já funciona. Ao atender na Connect API ou no HUB, o receptor publicava atendimento local, enquanto o originador e o smartphone continuavam tocando. Esta correção atua somente no aceite local do VoIP utilizado pela Connect API.

Base: `develop` em `195b8c5271caae7e023b294644bb1d6559ea1886`, versão `1.0.28`, já contendo a PR #98. Essa PR anterior permanece preservada.

### Causa verificada

`buildAcceptStanza` sincronizava/cifrava a resposta para `callCreator`, mas endereçava a stanza a `toUserJid(peerJid)`, descartando o segmento do dispositivo. A oferta recebida fornece o `peerJid` completo em `from`; `call-creator` é um campo separado da correlação da chamada. Quando os valores diferem, o aceite pode ser cifrado para outro device; o destino perdia o device mesmo quando os valores coincidiam.

`acceptCall` alterava o estado antes da preparação/envio, ignorava a ausência de chave e capturava o erro de envio sem propagá-lo. Isso permitia sucesso somente local.

### Escopo e alterações

Incluído: `acceptCall`/`buildAcceptStanza` nas duas distribuições CJS/ESM da dependência, testes desse percurso e documentação.

Fora do escopo: mudanças no HUB, UI, oferta de saída, lógica de encerramento/seleção já corrigida, banco, pareamento, troca de versão da biblioteca e deploy.

- Cifrar, sincronizar a sessão Signal e enviar o aceite para o `peerJid` completo da oferta.
- Preservar `call-creator`, `call-id`, formato da mensagem e identidade de mídia.
- Exigir chave de 32 bytes e propagar falhas de preparação/envio.
- Publicar `connecting` somente depois do envio do aceite.
- Preservar término remoto ou atendimento no smartphone ocorrido durante os awaits.
- Compartilhar um único envio entre atendimentos locais simultâneos.
- Reconhecer relay que tenha conectado antes da transição local.

### Decisões técnicas e arquitetura

Continuar usando o patch determinístico já instalado na PR #98. As substituições anteriores foram comparadas e preservadas byte a byte; foram acrescentadas somente as substituições do aceite. A verificação cobre agora oito arquivos da dependência, com hash antes/depois. Não existe código alternativo de chamada no HUB.

### Arquivos adicionados

- `test/zapo-voip-incoming-accept.test.cjs` — regressões do aceite gerado pela instância receptora.
- `CORRECAO-ACEITE-CHAMADA.md` — esta descrição e instruções de aplicação.

### Arquivos modificados

- `patches/zapo-voip-1.0.0.json` — correção do aceite CJS/ESM e hashes atualizados.
- `.gitignore` — incluir a nova suíte no versionamento.
- `docs/operations/zapo-multidevice-calls.md` — documentação do aceite e atualização da quantidade de arquivos verificados.

### Arquivos removidos

Não se aplica a esta alteração.

### Banco de dados

Não se aplica a esta alteração. Não há migrations, seeds, DROP ou modificações de dados/instâncias.

### APIs, contratos e integrações

Mantido `POST /call/accept/{instanceName}` com `callId` e autenticação existentes. O serviço continua aguardando `client.voip.acceptCall(callId)`. Erros reais do aceite propagam pelo tratamento HTTP existente. `sendNode` confirma envio local, não ACK remoto ou áudio bidirecional.

### Dependências e configurações

Mantidos `@innovatorssoft/voip@1.0.0` e `@innovatorssoft/zapo-js@1.6.3`. Sem novas variáveis, segredos ou dependências. O fluxo existente de `npm ci`/`postinstall` e Docker aplica a nova versão do patch.

### Segurança, privacidade, desempenho e observabilidade

Endereçamento de resposta vinculado ao device da oferta autenticada. Nenhum token, chave de chamada ou credencial é registrado nos testes/documentação. Nenhuma consulta extra de banco ou varredura de histórico. Falhas de preparação/envio são visíveis ao chamador em vez de virarem sucesso local.

### Testes implementados

A nova suíte percorre oferta de A → recebimento em B → `acceptCall` de B → processamento do `accept` gerado pelo próprio pacote em A. O transporte/Signal são simulados e validam explicitamente o device de destino; os builders, parsing, sessão e manager são reais. Inclui origem em device companion, origem em smartphone, falhas, concorrência, término remoto, atendimento no smartphone e relay antecipado.

### Testes executados

- Nova suíte de aceite: **21 aprovados, 0 falhas**.
- Mesma suíte contra a baseline isolada da PR #98: **2 aprovados, 19 falhas**. Os dois casos aprovados nessa baseline são origens em smartphone/device 0, em PN e LID.
- `npm run test:voip`: **63 aprovados, 0 falhas**, incluindo os 42 testes anteriores.
- `npm run build`: aprovado na API 1.0.28 com o manifesto novo.
- `npm run runtime:deps:check`: aprovado, oito arquivos com hashes corrigidos.
- Imports reais CJS/ESM do pacote: aprovados.
- `npm run docs:check`, sintaxe da nova suíte e `git diff --check`: aprovados.

Ambiente local Linux/Node 24.19.0. O workflow já existente executa também esta suíte em Node 22; os resultados remotos são publicados na PR. Não houve validação de rede WhatsApp real.

### Testes recomendados e validação manual

1. Atualizar as duas APIs para a imagem que contém esta correção.
2. A ligar para B e atender pela Connect API/HUB de B: A deve deixar de tocar, reconhecer o aceite e manter áudio bidirecional.
3. Confirmar que o smartphone B deixa de tocar sem derrubar o device que atendeu.
4. Repetir atendendo no smartphone B; preservar o comportamento confirmado pelo usuário.
5. Encerrar e repetir, sem sessões antigas na lista.

Chamadas, mídia e contas WhatsApp reais não foram testadas neste ambiente. Os prints fornecidos exibem versões `1.0.27` e `1.0.28`; a homologação deve conferir a versão efetivamente instalada nos dois lados.

### Impactos, compatibilidade e riscos

Contratos preservados. Mudança limitada ao aceite e ao tratamento de erro correspondente. A confirmação definitiva na rede WhatsApp exige homologação física; resultados do transporte simulado não substituem essa validação.

### Procedimento de deploy e distribuição

O ZIP incremental contém somente os cinco arquivos desta correção. Aplicar na raiz do projeto `develop` 1.0.28 que já contém a PR #98, ou utilizar a nova branch/PR diretamente.

Reinstalar dependências a partir do lockfile com `npm ci`, que baixa a dependência original e aplica o manifesto atualizado. Um `node_modules` que já recebeu o patch anterior tem hashes diferentes: não editar manualmente nem desabilitar a verificação; usar a reinstalação normal ou o build Docker.

```bash
npm ci
npm run test:voip
npm run runtime:deps:check
npm run build
npm run docs:check
```

Reconstruir a imagem no fluxo habitual e atualizar as instâncias participantes. Não usar apenas restart da imagem antiga. Nenhuma migration é necessária. Preservar volumes e pareamento.

### Procedimento de rollback

Se houver regressão, reimplantar somente a imagem anterior, preservando volumes/banco. Nenhum rollback destrutivo ou despareamento foi realizado ou é necessário para aplicar esta correção.

### Build e release

Build local da API executado com sucesso. Nenhuma release, tag, imagem de produção ou deploy publicado por esta tarefa. Incremento de versão fica a cargo do fluxo de release existente.

### Documentação

Guia operacional atualizado e esta descrição incluída no pacote incremental. Sem rotas/eventos novos; OpenAPI/AsyncAPI permanecem sincronizados.

### Checklist

- [x] Escopo restrito ao aceite local.
- [x] Revisão independente da implementação.
- [x] Substituições anteriores preservadas.
- [x] Contratos/banco/dependências preservados.
- [x] Testes, limites de evidência e deploy documentados.
- [ ] Homologação com duas contas e aparelhos WhatsApp reais.

## Commit sugerido

`fix(voip): envia aceite ao dispositivo originador da chamada`

## Merge sugerido

Squash após checks e homologação do aceite.

## Versão sugerida

Patch após `1.0.28`, pelo fluxo de release existente; sem incremento manual nesta PR.
