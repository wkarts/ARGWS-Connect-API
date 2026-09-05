# Connect|API DOCs — Standalone Produção

Deployment independente/always-on da documentação oficial estável.

- imagem: `ghcr.io/wkarts/argws-connect-docs:latest`;
- bind local: `127.0.0.1:38280`;
- URL pública padrão: `https://docs.connect.argws.com.br`;
- healthcheck: `/health`.

O hostname público é atendido pelo CloudPanel/Nginx usando `nginx-location.conf.example`. O container continua acessível localmente pela porta 38280 sem depender da API.

**Retaguarda emergencial:** comandos de scripts não compõem o deploy normal. Use somente o Compose e o `.env` no gerenciador da stack, conforme `OPERATIONS-CONTRACT.md`.

As stacks completas mantêm seus próprios DOCs integrados nas portas `3818x`. Esta stack é a documentação pública estável e pode permanecer online durante deploys da API.

## Contrato operacional vigente

No gerenciador de stacks, forneça o Compose deste deployment e o `.env`, preservando os volumes existentes. Credenciais de registry pertencem à configuração do gerenciador. O pooler gera seus próprios arquivos dentro do container; migrations, bootstrap e backup continuam sob responsabilidade dos serviços. Atualize as imagens homologadas pela ação de atualização da stack, sem aplicadores externos ou overlays obrigatórios. Consulte `OPERATIONS-CONTRACT.md` e `docs/guides/database-pooling.md`.
