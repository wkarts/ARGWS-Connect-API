# Connect|API Deployer — núcleo Rust

Este crate produz o `argws-connect-deployer-win-x64.exe` sem Node.js embutido.
Os templates de `deploy/` são incorporados em tempo de compilação e o `build.rs`
monta o recurso `.ico` com os mesmos PNGs do Auth Assistant:

- `browser-extensions/findhub-auth/icons/icon-16.png`
- `browser-extensions/findhub-auth/icons/icon-32.png`
- `browser-extensions/findhub-auth/icons/icon-48.png`
- `browser-extensions/findhub-auth/icons/icon-128.png`

No Windows, compile com o SDK instalado e `RC_EXE` apontando para `rc.exe`:

```powershell
$env:RC_EXE = 'C:\Program Files (x86)\Windows Kits\10\bin\<versao>\x64\rc.exe'
cargo +1.90.0 test --manifest-path tools/connect-deployer/native/Cargo.toml
cargo +1.90.0 build --manifest-path tools/connect-deployer/native/Cargo.toml --release
```
