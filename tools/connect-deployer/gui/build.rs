use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

fn wpath(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
}

fn make_ico(root: &Path, output: &Path) {
    let sizes = [16u8, 32, 48, 128];
    let mut images = Vec::new();
    for size in sizes {
        let path = root
            .join("browser-extensions/findhub-auth/icons")
            .join(format!("icon-{size}.png"));
        println!("cargo:rerun-if-changed={}", path.display());
        images.push(fs::read(path).expect("Find Hub Auth icon is required"));
    }
    // The ICO table is intentionally identical to the Auth Assistant build.
    let header_size = 6 + 16 * images.len();
    let mut header = vec![0u8; header_size];
    header[2] = 1;
    header[4] = images.len() as u8;
    let mut offset = header_size as u32;
    for (index, image) in images.iter().enumerate() {
        let entry = 6 + 16 * index;
        header[entry] = sizes[index];
        header[entry + 1] = sizes[index];
        header[entry + 4..entry + 6].copy_from_slice(&1u16.to_le_bytes());
        header[entry + 6..entry + 8].copy_from_slice(&32u16.to_le_bytes());
        header[entry + 8..entry + 12].copy_from_slice(&(image.len() as u32).to_le_bytes());
        header[entry + 12..entry + 16].copy_from_slice(&offset.to_le_bytes());
        offset += image.len() as u32;
    }
    let mut ico = header;
    for image in images {
        ico.extend_from_slice(&image);
    }
    fs::write(output, ico).expect("Unable to write native deployer GUI icon");
}

fn compile_windows_resource(root: &Path, out: &Path) {
    let ico = out.join("connect-findhub.ico");
    make_ico(root, &ico);
    let manifest = out.join("application.manifest");
    fs::write(
        &manifest,
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
<assemblyIdentity version="0.2.0.0" processorArchitecture="amd64" name="ARGWS.Connect.Deployer.GUI" type="win32"/>
<description>Connect API Deployer — Interface gráfica</description>
<trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo>
<dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/></dependentAssembly></dependency>
</assembly>"#,
    )
    .expect("Unable to write native deployer GUI manifest");
    let rc = out.join("application.rc");
    let res = out.join("application.res");
    let resource = format!(
        r#"#pragma code_page(65001)
1 ICON "{}"
1 24 "{}"
1 VERSIONINFO
FILEVERSION 0,2,0,0
PRODUCTVERSION 0,2,0,0
BEGIN
 BLOCK "StringFileInfo"
 BEGIN
  BLOCK "041604b0"
  BEGIN
   VALUE "CompanyName", "ARGWS\0"
   VALUE "FileDescription", "Connect API Deployer — Interface gráfica (Rust)\0"
   VALUE "FileVersion", "0.2.0\0"
   VALUE "ProductName", "Connect API Deployer GUI\0"
   VALUE "ProductVersion", "0.2.0\0"
  END
 END
 BLOCK "VarFileInfo"
 BEGIN
  VALUE "Translation", 0x416, 1200
 END
END
"#,
        wpath(&ico),
        wpath(&manifest)
    );
    fs::write(&rc, resource).expect("Unable to write native deployer GUI resources");
    let tool = env::var_os("RC_EXE").unwrap_or_else(|| "rc.exe".into());
    let status = Command::new(tool)
        .arg("/nologo")
        .arg(format!("/fo{}", res.display()))
        .arg(&rc)
        .status()
        .expect("Windows SDK resource compiler required");
    assert!(status.success(), "Windows GUI resource compilation failed");
    println!("cargo:rustc-link-arg={}", res.display());
}

fn main() {
    let crate_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let root = crate_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .expect("repository root not found");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        compile_windows_resource(root, &PathBuf::from(env::var("OUT_DIR").unwrap()));
    }
}
