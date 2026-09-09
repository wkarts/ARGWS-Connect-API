# Connect|API — Interface Principal

Esta pasta contém a nova interface principal do Connect|API integrada ao backend atual sem alterar o código funcional do backend.

## Regras desta entrega

- Nome visível do produto: **Connect|API**.
- Não exibir termos internos de infraestrutura, tecnologias, licenciamento ou telemetria.
- Não exibir a palavra `Manager` na interface.
- Usar somente os logos, favicons e ícones de marca já existentes no projeto `develop`.
- Manter a integração com o backend isolada em `src/services/`.
- Preservar as telas e o design quando o backend evoluir; mudanças de contrato devem ser absorvidas pelos adaptadores.

## Compatibilidade com o backend atual

A configuração padrão usa:

```text
compatibility: current
authMode: access-code
```

Neste modo, o frontend conversa diretamente com os endpoints já existentes no backend e usa o código administrativo global atual como **Código de acesso**.

O valor fica em `sessionStorage` e é removido ao sair.

## Endereços

A mesma interface pode ser usada em:

```text
https://d.api.connect.argws.com.br/manager/
```

ou no domínio dedicado:

```text
https://d.manager.connect.argws.com.br/
```

No domínio dedicado, `public/assets/runtime-config.js` deriva automaticamente o domínio irmão da API (`d.manager...` → `d.api...`).

## Recursos ligados hoje

- acesso administrativo atual;
- visão geral;
- instâncias;
- criação de instância;
- conexão por QR Code;
- conexão por código de pareamento;
- reinício, desconexão e exclusão de instância;
- canais;
- conversas;
- envio de mensagem de texto;
- histórico de mensagens por instância;
- contatos por instância;
- chamadas;
- saúde;
- atualizações;
- aparência clara/escura.

Recursos cuja camada atual ainda não oferece os contratos necessários ficam preparados visualmente ou ocultos por `features`, sem inventar dados.

## Build

```bash
npm install
npm run check:language
npm run build
```

O `Dockerfile` da raiz também instala as dependências desta pasta antes de gerar a interface embutida em `/manager/`.

## Proteção da interface contra mudanças futuras

Preserve principalmente estes contratos internos:

```text
src/types/domain.ts
src/services/connect.ts
src/services/normalizers.ts
```

Quando o backend novo estiver pronto, implemente/ajuste um adaptador e mantenha as views estáveis.
