# Connect|API DOCs — Standalone Develop

Deployment independente/always-on da documentação do canal de desenvolvimento.

- imagem: `ghcr.io/wkarts/argws-connect-docs:develop`;
- bind local: `127.0.0.1:38282`;
- URL pública padrão: `https://d.docs.connect.argws.com.br`;
- healthcheck: `/health`.

Esse ambiente acompanha a branch `develop` e não interfere na documentação estável em `docs.connect.argws.com.br`.

**Retaguarda emergencial:** comandos de scripts não compõem o deploy normal. Use somente o Compose e o `.env` no gerenciador da stack, conforme `OPERATIONS-CONTRACT.md`.

## Contrato operacional vigente

No gerenciador de stacks, forneça o Compose deste deployment e o `.env`, preservando os volumes existentes. Credenciais de registry pertencem à configuração do gerenciador. O pooler gera seus próprios arquivos dentro do container; migrations, bootstrap e backup continuam sob responsabilidade dos serviços. Atualize as imagens homologadas pela ação de atualização da stack, sem aplicadores externos ou overlays obrigatórios. Consulte `OPERATIONS-CONTRACT.md` e `docs/guides/database-pooling.md`.
