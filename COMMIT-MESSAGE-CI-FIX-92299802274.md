fix(ci): resolve canonical lint errors after Zapo integration

- keep Baileys behavior unchanged while typing fetchAllGroups safely
- remove unnecessary Baileys pairing helper additions
- remove stale WavoIP bridge hooks from Baileys
- replace forbidden require imports in Zapo provider
- fix unused import and Prettier violations
- keep Zapo and VoIP provider modules lazy-loaded
- fix formatting in call and channel services
- preserve successful amd64/arm64 image builds

Fixes Canonical CI Core run 92299802274.
