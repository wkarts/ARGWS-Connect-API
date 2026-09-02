# Template Studio — Importação e Exportação

O Template Studio possui um Centro de Transferência para mover soluções conversacionais entre instâncias e ambientes sem transportar segredos.

## Escopos de exportação

- **Solução atual**: template selecionado, dependências Action/Recipe e Micro Apps vinculados.
- **Template atual**: somente o contrato do template selecionado.
- **Integrações**: Actions e Recipes cadastradas na instância.
- **Micro Apps**: Micro Apps encontrados nos templates da instância.
- **Workspace completo**: templates, Actions, Recipes e Micro Apps.

## Formatos

### ARGWS Package (`.argws`)

Formato canônico versionado:

```json
{
  "schema": "argws.connect.studio.bundle",
  "version": 1,
  "templates": [],
  "actions": [],
  "recipes": [],
  "microApps": []
}
```

É o formato recomendado para backup lógico, promoção entre ambientes e compartilhamento de soluções completas.

### JSON (`.json`)

O importador detecta automaticamente:

- bundle Connect|API;
- template individual;
- Action individual;
- Recipe individual;
- Micro App individual;
- array de entidades;
- payload Meta contendo `name`, `language`, `category` e `components`;
- resposta Meta com templates em `data[]`.

### NDJSON / JSONL (`.ndjson`, `.jsonl`)

Uma entidade por linha. É adequado para pipelines, versionamento e processamento incremental.

### CSV (`.csv`)

O formato de intercâmbio usa as colunas:

```text
kind,key,payload
```

`payload` contém JSON escapado, permitindo preservar objetos e arrays sem reduzir o contrato a campos planos.

### Meta Template JSON

A exportação gera somente o contrato transportável de template da Meta:

```json
{
  "name": "appointment_confirmation",
  "language": "pt_BR",
  "category": "UTILITY",
  "components": []
}
```

## Segurança

A exportação remove por padrão propriedades com nomes de segredo, senha, token, API key, `Authorization` e cookies.

`credentialRef` permanece porque é somente uma referência lógica. O valor real da credencial deve existir separadamente no ambiente de destino.

O importador não executa automaticamente Actions/Recipes durante a análise do arquivo.

## Estratégias de conflito

- **Ignorar existente**: mantém a entidade já cadastrada.
- **Substituir existente**: atualiza a entidade existente quando permitido.
- **Renomear**: cria nova key/nome e atualiza referências internas Action/Recipe quando possível.

Templates `SYSTEM` ou `isDefault=true` são protegidos e não são substituídos pelo importador.

## Ordem de importação

Quando um pacote contém uma solução completa, o Studio aplica as dependências nesta ordem:

```text
Actions
  ↓
Recipes
  ↓
Templates
  ↓
Micro Apps
```

As Recipes recebem as Action keys remapeadas quando a estratégia `Renomear` é usada. Bindings de templates e Micro Apps também são remapeados para as novas keys.

## Micro Apps isolados

Um Micro App exportado isoladamente mantém `templateRef` quando possível.

Na importação:

1. o Studio tenta encontrar o template referenciado;
2. se não existir, usa o template atualmente selecionado;
3. se não houver destino, a importação é interrompida antes de aplicar aquele Micro App.

## Recomendações

Use `.argws` para transportar soluções completas entre desenvolvimento, homologação e produção. Use Meta JSON quando a finalidade for interoperabilidade direta com o contrato de templates Meta. Use NDJSON/CSV para automação e inventário.
