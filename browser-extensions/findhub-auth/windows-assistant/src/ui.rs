// Native Win32 UI. No browser automation, remote webview, credential access or policy modification.
use crate::install;
use std::{
    ffi::c_void,
    path::PathBuf,
    process::Command,
    ptr::{null, null_mut},
    sync::atomic::{AtomicPtr, Ordering},
};
type H = *mut c_void;
type Proc = unsafe extern "system" fn(H, u32, usize, isize) -> isize;
#[repr(C)]
struct WindowClass {
    style: u32,
    procedure: Option<Proc>,
    class_extra: i32,
    window_extra: i32,
    instance: H,
    icon: H,
    cursor: H,
    background: H,
    menu: *const u16,
    name: *const u16,
}
#[repr(C)]
struct Point {
    x: i32,
    y: i32,
}
#[repr(C)]
struct Message {
    hwnd: H,
    message: u32,
    wparam: usize,
    lparam: isize,
    time: u32,
    point: Point,
    private: u32,
}
#[link(name = "user32")]
extern "system" {
    fn RegisterClassW(class: *const WindowClass) -> u16;
    fn CreateWindowExW(
        ex: u32,
        class: *const u16,
        title: *const u16,
        style: u32,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        parent: H,
        menu: H,
        instance: H,
        param: H,
    ) -> H;
    fn DefWindowProcW(hwnd: H, msg: u32, wparam: usize, lparam: isize) -> isize;
    fn GetMessageW(msg: *mut Message, hwnd: H, min: u32, max: u32) -> i32;
    fn TranslateMessage(msg: *const Message) -> i32;
    fn DispatchMessageW(msg: *const Message) -> isize;
    fn IsDialogMessageW(hwnd: H, msg: *mut Message) -> i32;
    fn PostQuitMessage(code: i32);
    fn LoadIconW(instance: H, name: *const u16) -> H;
    fn LoadCursorW(instance: H, name: *const u16) -> H;
    fn SendMessageW(hwnd: H, msg: u32, wparam: usize, lparam: isize) -> isize;
    fn SetWindowTextW(hwnd: H, text: *const u16) -> i32;
    fn MessageBoxW(hwnd: H, text: *const u16, title: *const u16, flags: u32) -> i32;
    fn EnableWindow(hwnd: H, enable: i32) -> i32;
    fn GetDlgItem(hwnd: H, id: i32) -> H;
    fn SetProcessDPIAware() -> i32;
    fn OpenClipboard(hwnd: H) -> i32;
    fn EmptyClipboard() -> i32;
    fn SetClipboardData(format: u32, mem: H) -> H;
    fn CloseClipboard() -> i32;
}
#[link(name = "kernel32")]
extern "system" {
    fn GetModuleHandleW(name: *const u16) -> H;
    fn GlobalAlloc(flags: u32, bytes: usize) -> H;
    fn GlobalLock(mem: H) -> H;
    fn GlobalUnlock(mem: H) -> i32;
    fn GlobalFree(mem: H) -> H;
}
#[link(name = "shell32")]
extern "system" {
    fn ShellExecuteW(
        hwnd: H,
        op: *const u16,
        file: *const u16,
        args: *const u16,
        dir: *const u16,
        show: i32,
    ) -> H;
}
#[link(name = "gdi32")]
extern "system" {
    fn CreateFontW(
        height: i32,
        width: i32,
        esc: i32,
        orientation: i32,
        weight: i32,
        italic: u32,
        underline: u32,
        strike: u32,
        charset: u32,
        out: u32,
        clip: u32,
        quality: u32,
        pitch: u32,
        face: *const u16,
    ) -> H;
}
static STATUS: AtomicPtr<c_void> = AtomicPtr::new(null_mut());
static FONT: AtomicPtr<c_void> = AtomicPtr::new(null_mut());
fn w(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}
unsafe fn label(hwnd: H, text: &str, x: i32, y: i32, width: i32, height: i32) -> H {
    let h = CreateWindowExW(
        0,
        w("STATIC").as_ptr(),
        w(text).as_ptr(),
        0x50000000,
        x,
        y,
        width,
        height,
        hwnd,
        null_mut(),
        GetModuleHandleW(null()),
        null_mut(),
    );
    SendMessageW(h, 0x0030, FONT.load(Ordering::Relaxed) as usize, 1);
    h
}
unsafe fn button(hwnd: H, id: i32, text: &str, x: i32, y: i32, width: i32) -> H {
    let h = CreateWindowExW(
        0,
        w("BUTTON").as_ptr(),
        w(text).as_ptr(),
        0x50010000,
        x,
        y,
        width,
        36,
        hwnd,
        id as H,
        GetModuleHandleW(null()),
        null_mut(),
    );
    SendMessageW(h, 0x0030, FONT.load(Ordering::Relaxed) as usize, 1);
    h
}
unsafe fn status(text: &str) {
    SetWindowTextW(STATUS.load(Ordering::Relaxed), w(text).as_ptr());
}
unsafe fn alert(hwnd: H, text: &str) {
    MessageBoxW(
        hwnd,
        w(text).as_ptr(),
        w("Connect|API — Find Hub Auth").as_ptr(),
        0x10,
    );
}
fn browser(name: &str) -> Option<PathBuf> {
    let paths = match name {
        "chrome" => vec!["Google/Chrome/Application/chrome.exe"],
        "edge" => vec!["Microsoft/Edge/Application/msedge.exe"],
        "brave" => vec!["BraveSoftware/Brave-Browser/Application/brave.exe"],
        "vivaldi" => vec!["Vivaldi/Application/vivaldi.exe"],
        _ => vec![],
    };
    for var in ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(base) = std::env::var_os(var) {
            for path in &paths {
                let p = PathBuf::from(&base).join(path);
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }
    None
}
unsafe fn copy_path(hwnd: H) -> Result<(), String> {
    let folder = install::root()
        .map_err(|e| e.to_string())?
        .join("extension");
    let text = w(&folder.to_string_lossy());
    if OpenClipboard(hwnd) == 0 {
        return Err("Área de transferência ocupada. Tente novamente.".into());
    }
    let mem = GlobalAlloc(0x0002, text.len() * 2);
    if mem.is_null() {
        CloseClipboard();
        return Err("Memória indisponível.".into());
    }
    let dest = GlobalLock(mem);
    if dest.is_null() {
        GlobalFree(mem);
        CloseClipboard();
        return Err("Memória indisponível.".into());
    }
    std::ptr::copy_nonoverlapping(text.as_ptr(), dest as *mut u16, text.len());
    GlobalUnlock(mem);
    if EmptyClipboard() == 0 || SetClipboardData(13, mem).is_null() {
        GlobalFree(mem);
        CloseClipboard();
        return Err("Não foi possível copiar a pasta.".into());
    }
    CloseClipboard();
    Ok(())
}
unsafe fn launch_browser(hwnd: H, name: &str) -> Result<(), String> {
    let root = install::root().map_err(|e| e.to_string())?;
    install::verify(&root).map_err(|e| e.to_string())?;
    let executable = browser(name).ok_or_else(|| {
        "Navegador não localizado. Abra-o manualmente e acesse a página de extensões.".to_string()
    })?;
    let scheme = if name == "edge" {
        "edge"
    } else if name == "brave" {
        "brave"
    } else if name == "vivaldi" {
        "vivaldi"
    } else {
        "chrome"
    };
    Command::new(executable)
        .arg(format!("{scheme}://extensions/"))
        .spawn()
        .map_err(|e| e.to_string())?;
    copy_path(hwnd)?;
    status("Pasta copiada. Primeira instalação: Modo do desenvolvedor → Carregar sem compactação.\r\nAtualização: clique em Recarregar no card da extensão. A aprovação é feita por você no navegador.");
    Ok(())
}
unsafe extern "system" fn procedure(hwnd: H, msg: u32, wp: usize, lp: isize) -> isize {
    match msg {
        0x0001 => {
            let font = CreateFontW(
                -17,
                0,
                0,
                0,
                400,
                0,
                0,
                0,
                1,
                0,
                0,
                5,
                0,
                w("Segoe UI").as_ptr(),
            );
            FONT.store(font, Ordering::Relaxed);
            let title = label(
                hwnd,
                &format!("Connect|API — Find Hub Auth {}", install::VERSION),
                24,
                22,
                690,
                40,
            );
            let heading = CreateFontW(
                -25,
                0,
                0,
                0,
                600,
                0,
                0,
                0,
                1,
                0,
                0,
                5,
                0,
                w("Segoe UI").as_ptr(),
            );
            SendMessageW(title, 0x0030, heading as usize, 1);
            label(
                hwnd,
                "Assistente Windows nativo em Rust • Sem administrador • Sem telemetria",
                24,
                66,
                710,
                30,
            );
            label(hwnd, "1. Prepare os arquivos da extensão", 24, 114, 700, 26);
            button(hwnd, 100, "Instalar / atualizar arquivos", 24, 146, 330);
            button(hwnd, 101, "Verificar instalação", 370, 146, 330);
            label(
                hwnd,
                "2. Abra o navegador para aprovar ou recarregar",
                24,
                204,
                700,
                26,
            );
            for (i, (name, id)) in [
                ("Google Chrome", 102),
                ("Microsoft Edge", 103),
                ("Brave *", 104),
                ("Vivaldi *", 105),
            ]
            .iter()
            .enumerate()
            {
                button(hwnd, *id, name, 24 + i as i32 * 174, 239, 163);
            }
            button(hwnd, 106, "Copiar caminho da extensão", 24, 294, 330);
            button(hwnd, 107, "Abrir pasta instalada", 370, 294, 330);
            label(hwnd,"* Outros Chromium: depende das APIs e políticas do fabricante; não há homologação universal.",24,345,704,44);
            label(hwnd,"A extensão self-hosted precisa de sua aprovação inicial no navegador. O assistente não altera\r\npolíticas, perfis ou sessões, não desativa proteções e não acessa sua conta Google.",24,396,714,58);
            let h=label(hwnd,"Pronto. Clique em Instalar / atualizar arquivos.\r\nUma falha HTTP 400 de autenticação Google não é resolvida pela instalação do EXE.",24,476,704,66);
            STATUS.store(h, Ordering::Relaxed);
            0
        }
        0x0111 => {
            let id = (wp & 0xffff) as i32;
            let action: Result<(), String> = match id {
                100 => {
                    EnableWindow(GetDlgItem(hwnd, 100), 0);
                    let res = install::root()
                        .and_then(|p| install::install(&p))
                        .map_err(|e| e.to_string());
                    EnableWindow(GetDlgItem(hwnd, 100), 1);
                    if res.is_ok() {
                        status("Arquivos instalados e verificados. Agora abra o navegador abaixo.\r\nNa primeira vez, carregue a pasta; nas próximas, clique em Recarregar. O login Google ainda será feito no Manager.");
                    }
                    res
                }
                101 => {
                    let res = install::root()
                        .and_then(|p| install::verify(&p))
                        .map_err(|e| e.to_string());
                    if res.is_ok() {
                        status("Todos os arquivos conferem com o pacote embutido neste executável.\r\nEsta verificação não confirma a ativação da extensão nem autenticação Google.");
                    }
                    res
                }
                102 => launch_browser(hwnd, "chrome"),
                103 => launch_browser(hwnd, "edge"),
                104 => launch_browser(hwnd, "brave"),
                105 => launch_browser(hwnd, "vivaldi"),
                106 => {
                    let res = copy_path(hwnd);
                    if res.is_ok() {
                        status("Caminho copiado. Cole no seletor de pasta de Carregar sem compactação.\r\nMantenha a pasta instalada; não carregue a extensão de uma pasta temporária.");
                    }
                    res
                }
                107 => install::root().map_err(|e| e.to_string()).and_then(|p| {
                    let folder = p.join("extension");
                    if !folder.is_dir() {
                        return Err("Prepare os arquivos primeiro.".into());
                    }
                    let result = ShellExecuteW(
                        hwnd,
                        w("open").as_ptr(),
                        w(&folder.to_string_lossy()).as_ptr(),
                        null(),
                        null(),
                        1,
                    ) as isize;
                    if result <= 32 {
                        Err("Não foi possível abrir a pasta.".into())
                    } else {
                        Ok(())
                    }
                }),
                _ => Ok(()),
            };
            if let Err(error) = action {
                status("A operação não foi concluída. Consulte a mensagem exibida.");
                alert(hwnd, &error);
            }
            0
        }
        0x0002 => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wp, lp),
    }
}
pub fn run() {
    unsafe {
        SetProcessDPIAware();
        let instance = GetModuleHandleW(null());
        let class_name = w("ARGWS.FindHub.RustAssistant");
        let class = WindowClass {
            style: 3,
            procedure: Some(procedure),
            class_extra: 0,
            window_extra: 0,
            instance,
            icon: LoadIconW(instance, 1 as *const u16),
            cursor: LoadCursorW(null_mut(), 32512 as *const u16),
            background: 6 as H,
            menu: null(),
            name: class_name.as_ptr(),
        };
        if RegisterClassW(&class) == 0 {
            alert(null_mut(), "Não foi possível criar a janela.");
            return;
        }
        let hwnd = CreateWindowExW(
            0x00040000,
            class_name.as_ptr(),
            w("Connect|API — Find Hub Auth | Assistente Windows").as_ptr(),
            0x10CA0000,
            0x80000000u32 as i32,
            0x80000000u32 as i32,
            752,
            606,
            null_mut(),
            null_mut(),
            instance,
            null_mut(),
        );
        if hwnd.is_null() {
            alert(null_mut(), "Não foi possível criar a janela.");
            return;
        }
        let mut message: Message = std::mem::zeroed();
        while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
            if IsDialogMessageW(hwnd, &mut message) == 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }
}

pub fn show_error(text: &str) {
    unsafe {
        alert(null_mut(), text);
    }
}
