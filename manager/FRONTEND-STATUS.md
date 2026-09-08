# Estado da integração

## Backend preservado

Nenhum arquivo dentro de `src/` do backend foi alterado nesta entrega. Prisma, `package.json` e `package-lock.json` da raiz também permanecem idênticos ao ZIP de origem.

O ajuste da raiz limita-se ao `Dockerfile`, para instalar as dependências do novo frontend antes de gerar o bundle que já é servido pela API em `/manager/`.

## Recursos funcionando com o backend atual

- acesso pelo código administrativo atual;
- restauração da sessão no navegador;
- visão geral;
- listagem e criação de instâncias;
- QR Code;
- código de pareamento;
- reinício, desconexão e exclusão de instâncias;
- canais;
- conversas;
- mensagens e envio de texto;
- contatos;
- chamadas;
- saúde;
- consulta da versão instalada;
- aparência da interface.

## Recursos preparados para a próxima evolução

- contas individuais de usuários;
- permissões por usuário;
- auditoria administrativa;
- autenticação em duas etapas para contas humanas;
- ramais e filas completos;
- fluxos e automações completos.

Esses recursos estão isolados por flags e não interferem no funcionamento atual.

## Identidade visual

Os assets de marca e favicon foram copiados exclusivamente de arquivos já presentes no projeto `develop`. Nenhuma marca, logo, favicon ou símbolo de produto novo foi criado para esta integração.
