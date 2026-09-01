# ARGWS Connect API — Repository Governance

## Objetivo

Centralizar a política técnica do repositório sem misturar desenvolvimento, canonização e release.

## Autoridade por branch

- `feature/*`, `fix/*`, `hotfix/*`, `refactor/*`: validação apenas; não publicam imagens nem versões.
- `develop`: validação + canal GHCR `:develop`; não cria SemVer, tag ou GitHub Release.
- `main`: validação + versionamento semântico + build multi-arch + GHCR versionado + tag + GitHub Release.

## Núcleo canônico

A lógica comum de qualidade vive em `.github/actions/ci-core/action.yml` e pode ser exposta por `.github/workflows/ci-core.yml`.

O núcleo preserva as validações existentes:

1. checkout com submodules;
2. `npm ci`;
3. lint;
4. sintaxe do runtime de compatibilidade do Manager quando presente;
5. testes de compatibilidade legada;
6. geração Prisma;
7. build.

Security Scan, Database Integrity, Deployment Integrity e Image Promotion Integrity continuam como validações especializadas.

## Promotion Guard

Toda PR para `main` deve respeitar o contrato canônico:

- `VERSION` e `RELEASE-MANIFEST.json` são propriedade do release workflow;
- `package.json.version` e os campos de versão do `package-lock.json` não podem ser promovidos por PR;
- a versão da imagem em `deploy/canonical` não pode ser antecipada por uma branch;
- alterações em governança (`.github/workflows`, `.github/actions`, scripts de SemVer e CODEOWNERS) exigem a label `governance:ci`;
- a próxima versão é exibida em dry-run antes do merge.

## SemVer

A política existente é preservada:

- `version:patch` ou mudança comum/fix => patch;
- `version:minor` ou `feat:` => minor;
- `version:major`, breaking marker ou `BREAKING CHANGE` => major.

Somente o workflow canônico da `main` materializa `VERSION`, `package.json`, `package-lock.json`, `RELEASE-MANIFEST.json`, tags e GitHub Releases.

## Migração segura

A implantação é feita em duas etapas:

1. instalar o núcleo e os guards na `main` sem substituir os workflows atuais;
2. após canonização, atualizar os callers de `main` e `develop` para consumir o núcleo canônico da `main`, mantendo os efeitos específicos de cada branch.

Durante a transição, as validações antigas permanecem ativas para evitar perda de cobertura.
