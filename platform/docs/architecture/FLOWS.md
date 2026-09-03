# Fluxos Operacionais

## 1. Provisionamento de tenant

```text
Control Plane cria tenant
  -> valida slug e hostname
  -> grava tenant PROVISIONING
  -> cria ProvisioningJob
  -> worker obtém lock
  -> cria usuário PostgreSQL exclusivo
  -> cria banco PostgreSQL exclusivo
  -> aplica migrations do tenant
  -> cria bucket MinIO/S3
  -> ativa domínio provisionado
  -> cria empresa inicial
  -> cria administrador do tenant
  -> cria serviço e templates padrão
  -> smoke validation
  -> tenant ACTIVE
```

Falhas deixam o job em `FAILED` e permitem retry idempotente pelo Control Plane.

## 2. Domínio personalizado

```text
Tenant/Control adiciona hostname
  -> status PENDING
  -> cliente configura CNAME/A
  -> verificação DNS
  -> status ACTIVE
  -> Domain Agent gera Nginx
  -> Certbot emite certificado
  -> Control Plane marca SSL ACTIVE
```

## 3. Contrato e recorrência

```text
Empresa + Cliente + Serviço
  -> Contrato recorrente
  -> Celery Beat
  -> RecurrenceService
  -> idempotency_key por contrato/competência
  -> Receivable OPEN
  -> Outbox receivable.created
```

Frequências suportadas: semanal, quinzenal, mensal, bimestral, trimestral, semestral e anual.

## 4. Emissão de cobrança

```text
Receivable OPEN
  -> seleciona BankAgreement
  -> BankingProvider.create_charge
  -> Charge REGISTERED
  -> salva nosso número/txid/linha/PIX
  -> Outbox charge.registered
  -> notification worker
  -> SMTP / Evolution API
```

O Sandbox permite validar todo o fluxo sem credenciais externas.

## 5. Pagamento

```text
Webhook bancário / CNAB / manual
  -> valida assinatura e idempotência
  -> cria Payment
  -> atualiza paid_amount e balance
  -> status PARTIALLY_PAID ou PAID
  -> cria Outbox payment.received
  -> conciliação
  -> recibo
  -> NFS-e conforme contrato
  -> confirmação SMTP/WhatsApp
```

## 6. CNAB

### Remessa

```text
Seleciona recebíveis
  -> valida empresa/conta/convênio
  -> monta CNAB 240
  -> verifica 240 posições
  -> salva documento imutável
  -> registra remessa e hash
```

### Retorno

```text
Upload retorno
  -> valida tamanho de cada registro
  -> calcula SHA-256
  -> impede reimportação
  -> extrai segmentos T/U
  -> registra eventos
  -> aplica ocorrências pelo adapter do banco
```

## 7. Conciliação

```text
Entrada bancária
  -> busca nosso número/txid/endToEndId/documento
  -> compara valor e data
  -> MATCHED / SUGGESTED / UNMATCHED / CONFLICT
  -> confirmação humana quando necessário
```

## 8. Notificações e régua de cobrança

```text
Celery Beat por timezone do tenant
  -> avalia D-7 / D-1 / D0 / D+1 / D+5
  -> resolve régua específica do contrato ou régua padrão
  -> consolida contatos financeiros
  -> renderiza template em sandbox
  -> cria Notification idempotente
  -> connect.notifications
  -> resolve configuração Empresa > Tenant > Plataforma
  -> SMTP / Evolution API
  -> registra external_id
  -> webhook de status
  -> SENT / DELIVERED / READ / FAILED
```

Eventos financeiros imediatos, como cobrança registrada e pagamento confirmado, continuam entrando pela Outbox transacional e convergem para a mesma fila de notificações.

## 9. Backup

```text
Celery Beat ou execução manual
  -> maintenance-safe snapshot metadata
  -> pg_dump Control Plane
  -> lista tenants
  -> pg_dump de cada banco de tenant
  -> exporta objetos MinIO/S3
  -> manifest.json
  -> checksums.sha256
  -> tar.zst
  -> age opcional
  -> Local + S3 + Drive + Dropbox
  -> retenção
```

## 10. Restore

```text
Confirmação explícita
  -> modo manutenção
  -> valida SHA-256 e manifest
  -> restaura Control Plane
  -> recria papéis e bancos de tenants
  -> restaura cada banco
  -> restaura objetos
  -> valida migrations/recursos
  -> remove modo manutenção
```
