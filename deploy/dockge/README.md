# Deploy — Dockge

Este stack foi preparado para importação direta no Dockge e usa somente imagens do GHCR.

## Instalação

1. Crie uma stack chamada `argws-connect-api`.
2. Cole o conteúdo de `compose.yaml` no editor do Dockge.
3. Copie todas as variáveis de `.env.example` para o `.env` da stack.
4. Troque todas as ocorrências `CHANGE_ME_*`.
5. Se o GHCR for privado, faça login no host Docker antes do deploy:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
```

6. Faça **Pull** e depois **Deploy/Up**.

## Portas

Por padrão:

- API: `127.0.0.1:8080`
- Manager: `127.0.0.1:3000`

Para acesso direto pela rede, altere `ARGWS_CONNECT_BIND_ADDRESS=0.0.0.0`. Quando houver CloudPanel/Nginx/Traefik no mesmo host, mantenha `127.0.0.1`.

## Perfis opcionais

O stack padrão sobe PostgreSQL e Redis. RabbitMQ e MinIO usam profiles `messaging`, `storage` e `full`. Se a interface do Dockge não habilitar profiles na instalação utilizada, remova temporariamente a chave `profiles` dos serviços que deseja ativar e faça o redeploy.

## Atualização

Use **Pull** e depois **Redeploy**. As imagens são mantidas no GHCR e não há build de código no servidor.
