# Validação — integração Tauri ao Connect|API

O relatório original do anexo (que não havia sido compilado) está preservado em
`reference/VALIDATION-upstream.md`. Ele não comprova os resultados do CI integrado.

O workflow raiz executa validação estrutural, testes do protocolo/agente Rust,
compila agentes musl de ambas as arquiteturas, confere ELF e loader, executa
self-test, compila Vue/TypeScript e os desktops Tauri/instaladores, testa a
identidade embutida fora do checkout e verifica todos os checksums.

Os resultados concretos de cada execução ficam no GitHub Actions e na PR.
Não declarar sucesso enquanto houver checks pendentes ou falhos. A anexação
à release estável exige uma promoção autorizada da aplicação e não é executada
pelos testes da PR. Não houve uso de segredos ou VPS reais na integração.
