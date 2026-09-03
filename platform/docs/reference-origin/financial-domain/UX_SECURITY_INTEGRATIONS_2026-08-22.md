# UX, segurança e integrações — 2026-08-22

Este incremento evolui o Control Plane e o ambiente financeiro sem alterar a separação interna multiempresa.

Principais contratos do incremento:

- configurações administrativas usam controles visuais; JSON deixa de ser a interface padrão;
- serviços internos não expõem marcas ou detalhes da infraestrutura ao cliente final;
- WhatsApp é um serviço gerenciado pela plataforma, com conexão, QR Code, status, reinicialização e desconexão;
- integrações externas permanecem opcionais e separadas dos serviços gerenciados;
- NFS-e apresenta explicitamente os conectores Portal Nacional e WebISS como capacidades administráveis no Control Plane;
- autenticação em duas etapas TOTP pode ser exigida por empresa e bloqueia a sessão financeira até configuração/validação;
- seleções de entidades financeiras devem permitir pesquisa por atributos úteis ao operador;
- cadastros de empresa e cliente PJ suportam consulta cadastral de CNPJ para preenchimento assistido;
- nomes técnicos internos, como códigos de perfis e provedores, não são apresentados como linguagem principal da interface.
