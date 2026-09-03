# Isolamento Multitenant e por Empresa

## Camadas de isolamento

### 1. Domínio

O hostname precisa existir em `tenant_domains`, estar ativo e pertencer a exatamente um tenant. Existe constraint única global para o hostname.

### 2. Token

O JWT do Tenant Plane carrega `tenant_id`. Esse valor precisa ser igual ao tenant resolvido pelo hostname. Token de outro tenant resulta em HTTP 403.

### 3. Sessão

Access tokens têm curta duração. Refresh tokens são armazenados somente como SHA-256, rotacionados a cada renovação e revogados explicitamente no logout. No navegador, a sessão é segregada por hostname para impedir compartilhamento acidental entre tenants.

### 4. Banco

Cada tenant possui um banco PostgreSQL próprio e um usuário exclusivo. O usuário do tenant:

- não é superuser;
- não cria bancos;
- não cria papéis;
- é proprietário somente do banco do próprio tenant.

O Control Plane guarda a credencial criptografada e abre a engine somente após resolver o tenant.

### 5. Storage

Cada tenant recebe bucket/prefixo exclusivo. O backend não aceita bucket fornecido pelo cliente; o bucket é derivado do `TenantContext`.

### 6. Cache

Chaves de domínio, sessão, lock e deduplicação incluem tenant/hostname. Alterações de domínio invalidam o cache.

### 7. Filas

Toda mensagem leva `tenant_id`, `company_id`, `event_id` e `correlation_id`. O worker resolve novamente o tenant antes de abrir o banco.

### 8. Empresa

Usuários não administrativos possuem vínculos `UserCompany`. Consultas e gravações financeiras verificam os CNPJs permitidos.

## Regras obrigatórias

- nunca aceitar `tenant_id` do body como fonte de verdade;
- nunca abrir banco de tenant antes da resolução de hostname/evento;
- nunca usar fallback para tenant em produção;
- nunca compartilhar credencial PostgreSQL entre tenants;
- nunca retornar 403 com detalhes que revelem existência de objeto de outro tenant; preferir 404 onde aplicável;
- nunca guardar tokens ou secrets em logs;
- sempre validar `company_id` nas operações financeiras;
- sempre confrontar token, hostname e contexto.

## Testes incluídos

A suíte cobre:

- escopo por empresa;
- token e senha;
- mapeamento dos modelos;
- idempotência de recorrência;
- importação segura;
- providers Sandbox;
- CNAB com 240 posições.

O pipeline CI executa os testes a cada push e pull request.
