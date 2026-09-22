use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

fn main() {
    let here = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let extension = here.parent().unwrap();
    let root = extension.parent().unwrap().parent().unwrap();
    let output = PathBuf::from(env::var("OUT_DIR").unwrap());
    let manifest = fs::read_to_string(extension.join("manifest.json")).unwrap();
    let version = manifest
        .split("\"version\"")
        .nth(1)
        .unwrap()
        .split('"')
        .nth(1)
        .unwrap();
    assert_eq!(
        version,
        env::var("CARGO_PKG_VERSION").unwrap(),
        "Cargo and extension versions must match"
    );
    assert!(
        version.split('.').count() == 3 && version.split('.').all(|n| n.parse::<u16>().is_ok())
    );
    println!("cargo:rustc-env=FINDHUB_EXTENSION_VERSION={version}");
    println!("cargo:rerun-if-changed=../manifest.json");
    let mut generated = String::from("pub const FILES: &[(&str, &[u8])] = &[\n");
    for name in [
        "manifest.json",
        "policy.js",
        "background.js",
        "approve.html",
        "approve.js",
        "approve.css",
        "README.md",
        "icons/icon-16.png",
        "icons/icon-32.png",
        "icons/icon-48.png",
        "icons/icon-128.png",
    ] {
        let source = extension.join(name).canonicalize().unwrap();
        println!("cargo:rerun-if-changed={}", source.display());
        generated.push_str(&format!(
            "({name:?}, include_bytes!({:?})),\n",
            source.to_str().unwrap()
        ));
    }
    generated.push_str("];\n");
    fs::write(output.join("payload.rs"), generated).unwrap();
    if env::var("CARGO_CFG_TARGET_OS").unwrap() != "windows" {
        return;
    }
    let ico = root
        .join("build/findhub-extension/connect-findhub.ico")
        .canonicalize()
        .expect("Run scripts/build-findhub-distribution.cjs before building on Windows");
    let manifest_xml = output.join("application.manifest");
    fs::write(&manifest_xml, r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
<assemblyIdentity version="1.0.0.0" processorArchitecture="amd64" name="ARGWS.FindHub.Assistant" type="win32"/>
<description>Connect API Find Hub Auth</description>
<trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo>
<dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/></dependentAssembly></dependency>
</assembly>"#).unwrap();
    let escape = |p: &Path| p.to_str().unwrap().replace('\\', "\\\\");
    let numbers = version.replace('.', ",");
    let resource = format!(
        r#"#pragma code_page(65001)
1 ICON "{}"
1 24 "{}"
1 VERSIONINFO
FILEVERSION {},0
PRODUCTVERSION {},0
BEGIN
 BLOCK "StringFileInfo"
 BEGIN
  BLOCK "041604b0"
  BEGIN
   VALUE "CompanyName", "ARGWS\0"
   VALUE "FileDescription", "Connect API - Assistente Find Hub Auth (Rust)\0"
   VALUE "FileVersion", "{}\0"
   VALUE "ProductName", "Connect API Find Hub Auth\0"
   VALUE "ProductVersion", "{}\0"
  END
 END
 BLOCK "VarFileInfo"
 BEGIN
  VALUE "Translation", 0x416, 1200
 END
END
"#,
        escape(&ico),
        escape(&manifest_xml),
        numbers,
        numbers,
        version,
        version
    );
    let rc = output.join("application.rc");
    let res = output.join("application.res");
    fs::write(&rc, resource).unwrap();
    let tool = env::var_os("RC_EXE").unwrap_or_else(|| "rc.exe".into());
    let status = Command::new(tool)
        .arg("/nologo")
        .arg(format!("/fo{}", res.display()))
        .arg(rc)
        .status()
        .expect("Windows SDK resource compiler required");
    assert!(status.success(), "Resource compilation failed");
    println!("cargo:rustc-link-arg={}", res.display());
}
