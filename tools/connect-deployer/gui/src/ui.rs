// Interface Win32 nativa em Rust, sem WebView, Node.js, instalador auxiliar ou runtime externo.
use argws_connect_deployer::{gui_generate, gui_validate, GuiGenerateRequest};
use std::{
    ffi::c_void,
    path::PathBuf,
    ptr::{null, null_mut},
    sync::atomic::{AtomicPtr, Ordering},
};

type H = *mut c_void;
type WindowProcedure = unsafe extern "system" fn(H, u32, usize, isize) -> isize;

#[repr(C)]
struct WindowClass {
    style: u32,
    procedure: Option<WindowProcedure>,
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

#[repr(C)]
struct BrowseInfo {
    owner: H,
    root: H,
    display_name: *mut u16,
    title: *const u16,
    flags: u32,
    callback: Option<unsafe extern "system" fn(H, u32, isize, isize) -> i32>,
    data: isize,
    image: i32,
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
        width: i32,
        height: i32,
        parent: H,
        menu: H,
        instance: H,
        param: H,
    ) -> H;
    fn DefWindowProcW(hwnd: H, message: u32, wparam: usize, lparam: isize) -> isize;
    fn GetMessageW(message: *mut Message, hwnd: H, min: u32, max: u32) -> i32;
    fn TranslateMessage(message: *const Message) -> i32;
    fn DispatchMessageW(message: *const Message) -> isize;
    fn IsDialogMessageW(hwnd: H, message: *mut Message) -> i32;
    fn PostQuitMessage(code: i32);
    fn LoadIconW(instance: H, name: *const u16) -> H;
    fn LoadCursorW(instance: H, name: *const u16) -> H;
    fn SendMessageW(hwnd: H, message: u32, wparam: usize, lparam: isize) -> isize;
    fn SetWindowTextW(hwnd: H, text: *const u16) -> i32;
    fn GetWindowTextLengthW(hwnd: H) -> i32;
    fn GetWindowTextW(hwnd: H, text: *mut u16, length: i32) -> i32;
    fn MessageBoxW(hwnd: H, text: *const u16, title: *const u16, flags: u32) -> i32;
    fn EnableWindow(hwnd: H, enable: i32) -> i32;
    fn GetDlgItem(hwnd: H, id: i32) -> H;
    fn SetProcessDPIAware() -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn GetModuleHandleW(name: *const u16) -> H;
}

#[link(name = "shell32")]
extern "system" {
    fn ShellExecuteW(
        hwnd: H,
        operation: *const u16,
        file: *const u16,
        parameters: *const u16,
        directory: *const u16,
        show: i32,
    ) -> H;
    fn SHBrowseForFolderW(info: *mut BrowseInfo) -> H;
    fn SHGetPathFromIDListW(item: H, path: *mut u16) -> i32;
}

#[link(name = "ole32")]
extern "system" {
    fn CoTaskMemFree(value: H);
}

#[link(name = "gdi32")]
extern "system" {
    fn CreateFontW(
        height: i32,
        width: i32,
        escapement: i32,
        orientation: i32,
        weight: i32,
        italic: u32,
        underline: u32,
        strike: u32,
        charset: u32,
        output_precision: u32,
        clip_precision: u32,
        quality: u32,
        pitch_and_family: u32,
        face: *const u16,
    ) -> H;
}

static FONT: AtomicPtr<c_void> = AtomicPtr::new(null_mut());
static STATUS: AtomicPtr<c_void> = AtomicPtr::new(null_mut());

const WM_CREATE: u32 = 0x0001;
const WM_DESTROY: u32 = 0x0002;
const WM_COMMAND: u32 = 0x0111;
const WM_SETFONT: u32 = 0x0030;
const CB_ADDSTRING: u32 = 0x0143;
const CB_SETCURSEL: u32 = 0x014e;
const BM_GETCHECK: u32 = 0x00f0;
const BST_CHECKED: isize = 1;
const EM_SETREADONLY: u32 = 0x00cf;

const ID_PREPARE: i32 = 100;
const ID_VALIDATE: i32 = 101;
const ID_OPEN: i32 = 102;
const ID_BROWSE: i32 = 103;
const ID_CREDENTIALS: i32 = 110;
const ID_TOKEN_MODE: i32 = 111;
const ID_FORCE: i32 = 112;

const ID_FLAVOR: i32 = 200;
const ID_OUTPUT: i32 = 201;
const ID_FROM_ENV: i32 = 202;
const ID_SERVER_URL: i32 = 203;
const ID_DOCS_URL: i32 = 204;
const ID_PROJECT_NAME: i32 = 205;
const ID_TOKEN: i32 = 206;

const ID_OPERATIONS: i32 = 300;
const ID_NATS: i32 = 301;
const ID_KAFKA: i32 = 302;
const ID_EXTENDED: i32 = 303;
const ID_MYSQL: i32 = 304;
const ID_TRACCAR: i32 = 305;

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

unsafe fn control_font(control: H) {
    SendMessageW(control, WM_SETFONT, FONT.load(Ordering::Relaxed) as usize, 1);
}

unsafe fn label(hwnd: H, text: &str, x: i32, y: i32, width: i32, height: i32) -> H {
    let control = CreateWindowExW(
        0,
        wide("STATIC").as_ptr(),
        wide(text).as_ptr(),
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
    control_font(control);
    control
}

unsafe fn button(hwnd: H, id: i32, text: &str, x: i32, y: i32, width: i32) -> H {
    let control = CreateWindowExW(
        0,
        wide("BUTTON").as_ptr(),
        wide(text).as_ptr(),
        0x50010000,
        x,
        y,
        width,
        34,
        hwnd,
        id as usize as H,
        GetModuleHandleW(null()),
        null_mut(),
    );
    control_font(control);
    control
}

unsafe fn checkbox(hwnd: H, id: i32, text: &str, x: i32, y: i32, width: i32) -> H {
    let control = CreateWindowExW(
        0,
        wide("BUTTON").as_ptr(),
        wide(text).as_ptr(),
        0x50010003,
        x,
        y,
        width,
        28,
        hwnd,
        id as usize as H,
        GetModuleHandleW(null()),
        null_mut(),
    );
    control_font(control);
    control
}

unsafe fn radio(hwnd: H, id: i32, text: &str, x: i32, y: i32, width: i32) -> H {
    let control = CreateWindowExW(
        0,
        wide("BUTTON").as_ptr(),
        wide(text).as_ptr(),
        0x50010009,
        x,
        y,
        width,
        28,
        hwnd,
        id as usize as H,
        GetModuleHandleW(null()),
        null_mut(),
    );
    control_font(control);
    control
}

unsafe fn edit(hwnd: H, id: i32, text: &str, x: i32, y: i32, width: i32) -> H {
    let control = CreateWindowExW(
        0x00000200,
        wide("EDIT").as_ptr(),
        wide(text).as_ptr(),
        0x50010080,
        x,
        y,
        width,
        28,
        hwnd,
        id as usize as H,
        GetModuleHandleW(null()),
        null_mut(),
    );
    control_font(control);
    control
}

unsafe fn combo(hwnd: H, id: i32, x: i32, y: i32, width: i32) -> H {
    let control = CreateWindowExW(
        0x00000200,
        wide("COMBOBOX").as_ptr(),
        null(),
        0x50210003,
        x,
        y,
        width,
        220,
        hwnd,
        id as usize as H,
        GetModuleHandleW(null()),
        null_mut(),
    );
    control_font(control);
    control
}

unsafe fn status_box(hwnd: H, id: i32, x: i32, y: i32, width: i32, height: i32) -> H {
    let control = CreateWindowExW(
        0x00000200,
        wide("EDIT").as_ptr(),
        wide("Pronto.").as_ptr(),
        0x50301044,
        x,
        y,
        width,
        height,
        hwnd,
        id as usize as H,
        GetModuleHandleW(null()),
        null_mut(),
    );
    control_font(control);
    control
}

unsafe fn set_text(hwnd: H, id: i32, text: &str) {
    SetWindowTextW(GetDlgItem(hwnd, id), wide(text).as_ptr());
}

unsafe fn text(hwnd: H, id: i32) -> String {
    let control = GetDlgItem(hwnd, id);
    if control.is_null() {
        return String::new();
    }
    let length = GetWindowTextLengthW(control).max(0) as usize;
    let mut buffer = vec![0u16; length + 1];
    let written = GetWindowTextW(control, buffer.as_mut_ptr(), buffer.len() as i32).max(0) as usize;
    String::from_utf16_lossy(&buffer[..written])
}

unsafe fn checked(hwnd: H, id: i32) -> bool {
    SendMessageW(GetDlgItem(hwnd, id), BM_GETCHECK, 0, 0) == BST_CHECKED
}

unsafe fn set_status(value: &str) {
    let status = STATUS.load(Ordering::Relaxed);
    if !status.is_null() {
        SetWindowTextW(status, wide(value).as_ptr());
    }
}

unsafe fn alert(hwnd: H, value: &str) {
    MessageBoxW(
        hwnd,
        wide(value).as_ptr(),
        wide("Connect|API — Deployer").as_ptr(),
        0x10,
    );
}

unsafe fn choose_output(hwnd: H) -> Result<(), String> {
    let mut display = [0u16; 260];
    let title = wide("Escolha a pasta onde a stack será preparada");
    let mut info = BrowseInfo {
        owner: hwnd,
        root: null_mut(),
        display_name: display.as_mut_ptr(),
        title: title.as_ptr(),
        flags: 0x0041,
        callback: None,
        data: 0,
        image: 0,
    };
    let item = SHBrowseForFolderW(&mut info);
    if item.is_null() {
        return Ok(());
    }
    let mut path = [0u16; 32768];
    let result = if SHGetPathFromIDListW(item, path.as_mut_ptr()) != 0 {
        let length = path.iter().position(|value| *value == 0).unwrap_or(path.len());
        let value = String::from_utf16_lossy(&path[..length]);
        set_text(hwnd, ID_OUTPUT, &value);
        Ok(())
    } else {
        Err("Não foi possível obter a pasta escolhida.".to_string())
    };
    CoTaskMemFree(item);
    result
}

unsafe fn open_output(hwnd: H) -> Result<(), String> {
    let value = text(hwnd, ID_OUTPUT);
    if value.trim().is_empty() {
        return Err("Informe a pasta de saída primeiro.".to_string());
    }
    let path = PathBuf::from(value.trim());
    if !path.is_dir() {
        return Err("A pasta ainda não existe. Prepare a stack primeiro.".to_string());
    }
    let result = ShellExecuteW(
        hwnd,
        wide("open").as_ptr(),
        wide(&path.to_string_lossy()).as_ptr(),
        null(),
        null(),
        1,
    ) as isize;
    if result <= 32 {
        Err("Não foi possível abrir a pasta de saída.".to_string())
    } else {
        Ok(())
    }
}

unsafe fn request(hwnd: H) -> Result<GuiGenerateRequest, String> {
    let output = text(hwnd, ID_OUTPUT);
    if output.trim().is_empty() {
        return Err("Informe a pasta de saída.".to_string());
    }
    let mut modules = Vec::new();
    for (id, name) in [
        (ID_OPERATIONS, "operations"),
        (ID_NATS, "nats"),
        (ID_KAFKA, "kafka"),
        (ID_EXTENDED, "extended"),
        (ID_MYSQL, "mysql"),
        (ID_TRACCAR, "traccar"),
    ] {
        if checked(hwnd, id) {
            modules.push(name.to_string());
        }
    }
    let auth = if checked(hwnd, ID_TOKEN_MODE) {
        "token".to_string()
    } else {
        "credentials".to_string()
    };
    let optional_path = text(hwnd, ID_FROM_ENV);
    Ok(GuiGenerateRequest {
        flavor: text(hwnd, ID_FLAVOR),
        modules,
        output: PathBuf::from(output.trim()),
        from_env: (!optional_path.trim().is_empty()).then(|| PathBuf::from(optional_path.trim())),
        traccar_auth: auth,
        traccar_token: text(hwnd, ID_TOKEN).trim().to_string(),
        traccar_admin_email: String::new(),
        server_url: text(hwnd, ID_SERVER_URL).trim().to_string(),
        docs_url: text(hwnd, ID_DOCS_URL).trim().to_string(),
        project_name: text(hwnd, ID_PROJECT_NAME).trim().to_string(),
        force: checked(hwnd, ID_FORCE),
    })
}

unsafe fn prepare(hwnd: H) {
    EnableWindow(GetDlgItem(hwnd, ID_PREPARE), 0);
    let result = request(hwnd).and_then(|value| gui_generate(value));
    EnableWindow(GetDlgItem(hwnd, ID_PREPARE), 1);
    match result {
        Ok(summary) => {
            let secrets = if summary.generated_secrets.is_empty() {
                "nenhum valor novo".to_string()
            } else {
                format!("{} variáveis", summary.generated_secrets.len())
            };
            set_status(&format!(
                "Stack preparada com sucesso.\r\nPasta: {}\r\nFlavor: {} | Imagem: {}\r\nMódulos: {}\r\nPerfis Compose: {}\r\nTraccar: {}\r\nSegredos gerados: {}\r\nAgora clique em Validar pasta antes de enviar ao servidor.",
                summary.output.display(),
                summary.flavor,
                summary.channel,
                if summary.modules.is_empty() { "base".to_string() } else { summary.modules.join(", ") },
                if summary.profiles.is_empty() { "nenhum".to_string() } else { summary.profiles },
                summary.traccar_authentication,
                secrets,
            ));
        }
        Err(error) => {
            set_status("A preparação foi interrompida. Consulte a mensagem de erro.");
            alert(hwnd, &error);
        }
    }
}

unsafe fn validate(hwnd: H) {
    let value = text(hwnd, ID_OUTPUT);
    if value.trim().is_empty() {
        alert(hwnd, "Informe a pasta de saída para validar.");
        return;
    }
    match gui_validate(value.trim()) {
        Ok(()) => set_status("Validação concluída: compose.yaml e .env estão compatíveis com o flavor e os módulos escolhidos."),
        Err(error) => {
            set_status("A validação encontrou problemas.");
            alert(hwnd, &error);
        }
    }
}

unsafe extern "system" fn procedure(hwnd: H, message: u32, wparam: usize, _lparam: isize) -> isize {
    match message {
        WM_CREATE => {
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
                wide("Segoe UI").as_ptr(),
            );
            FONT.store(font, Ordering::Relaxed);
            let title = label(hwnd, "Connect|API — Deployer", 26, 20, 780, 38);
            let heading = CreateFontW(
                -26,
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
                wide("Segoe UI").as_ptr(),
            );
            SendMessageW(title, WM_SETFONT, heading as usize, 1);
            label(hwnd, "Prepare e valide sua stack sem Node.js, sem shell e sem acesso remoto.", 26, 62, 780, 28);

            label(hwnd, "Flavor", 26, 106, 120, 26);
            let flavors = combo(hwnd, ID_FLAVOR, 150, 102, 230);
            for flavor in argws_connect_deployer::GUI_FLAVORS {
                SendMessageW(flavors, CB_ADDSTRING, 0, wide(flavor).as_ptr() as isize);
            }
            SendMessageW(flavors, CB_SETCURSEL, 0, 0);

            label(hwnd, "Pasta de saída", 26, 150, 120, 26);
            edit(hwnd, ID_OUTPUT, ".\\connect-api-stack", 150, 146, 555);
            button(hwnd, ID_BROWSE, "Escolher...", 716, 146, 112);

            label(hwnd, ".env existente", 26, 194, 120, 26);
            edit(hwnd, ID_FROM_ENV, "", 150, 190, 678);
            label(hwnd, "Opcional: caminho completo de um .env. As linhas e valores existentes são preservados.", 150, 220, 678, 22);

            label(hwnd, "SERVER_URL", 26, 258, 120, 26);
            edit(hwnd, ID_SERVER_URL, "", 150, 254, 678);
            label(hwnd, "ARGWS_CONNECT_DOCS_PUBLIC_URL", 26, 302, 120, 26);
            edit(hwnd, ID_DOCS_URL, "", 150, 298, 678);
            label(hwnd, "COMPOSE_PROJECT_NAME", 26, 346, 120, 26);
            edit(hwnd, ID_PROJECT_NAME, "", 150, 342, 678);

            label(hwnd, "Módulos opcionais", 26, 384, 160, 26);
            checkbox(hwnd, ID_OPERATIONS, "Operations", 190, 380, 130);
            checkbox(hwnd, ID_NATS, "NATS", 330, 380, 100);
            checkbox(hwnd, ID_KAFKA, "Kafka", 440, 380, 100);
            checkbox(hwnd, ID_EXTENDED, "Extended", 550, 380, 120);
            checkbox(hwnd, ID_MYSQL, "MySQL", 680, 380, 100);
            checkbox(hwnd, ID_TRACCAR, "Traccar", 190, 412, 130);
            SendMessageW(GetDlgItem(hwnd, ID_OPERATIONS), 0x00f1, 1, 0);

            label(hwnd, "Autenticação Traccar", 26, 454, 160, 26);
            radio(hwnd, ID_CREDENTIALS, "Credenciais internas (recomendado)", 190, 450, 270);
            radio(hwnd, ID_TOKEN_MODE, "Token existente", 470, 450, 170);
            SendMessageW(GetDlgItem(hwnd, ID_CREDENTIALS), 0x00f1, 1, 0);
            edit(hwnd, ID_TOKEN, "", 650, 450, 178);
            SendMessageW(GetDlgItem(hwnd, ID_TOKEN), EM_SETREADONLY, 1, 0);
            checkbox(hwnd, ID_FORCE, "Permitir substituir compose.yaml e .env existentes", 190, 486, 420);

            button(hwnd, ID_PREPARE, "Preparar stack", 26, 530, 190);
            button(hwnd, ID_VALIDATE, "Validar pasta", 226, 530, 190);
            button(hwnd, ID_OPEN, "Abrir pasta", 426, 530, 190);
            label(hwnd, "A GUI somente prepara e valida arquivos. Ela não executa deploy remoto.", 26, 574, 800, 24);
            let status = status_box(hwnd, 900, 26, 606, 802, 92);
            STATUS.store(status, Ordering::Relaxed);
            0
        }
        WM_COMMAND => {
            let id = (wparam & 0xffff) as i32;
            match id {
                ID_PREPARE => prepare(hwnd),
                ID_VALIDATE => validate(hwnd),
                ID_OPEN => {
                    if let Err(error) = open_output(hwnd) {
                        alert(hwnd, &error);
                    }
                }
                ID_BROWSE => {
                    if let Err(error) = choose_output(hwnd) {
                        alert(hwnd, &error);
                    }
                }
                ID_CREDENTIALS => {
                    SendMessageW(GetDlgItem(hwnd, ID_CREDENTIALS), 0x00f1, 1, 0);
                    SendMessageW(GetDlgItem(hwnd, ID_TOKEN_MODE), 0x00f1, 0, 0);
                    SendMessageW(GetDlgItem(hwnd, ID_TOKEN), EM_SETREADONLY, 1, 0);
                    EnableWindow(GetDlgItem(hwnd, ID_TOKEN), 0);
                }
                ID_TOKEN_MODE => {
                    SendMessageW(GetDlgItem(hwnd, ID_CREDENTIALS), 0x00f1, 0, 0);
                    SendMessageW(GetDlgItem(hwnd, ID_TOKEN_MODE), 0x00f1, 1, 0);
                    SendMessageW(GetDlgItem(hwnd, ID_TOKEN), EM_SETREADONLY, 0, 0);
                    EnableWindow(GetDlgItem(hwnd, ID_TOKEN), 1);
                }
                _ => {}
            }
            0
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, message, wparam, _lparam),
    }
}

pub fn run() {
    unsafe {
        SetProcessDPIAware();
        let instance = GetModuleHandleW(null());
        let class_name = wide("ARGWS.Connect.Deployer.GUI");
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
            show_error("Não foi possível registrar a janela do Deployer.");
            return;
        }
        let hwnd = CreateWindowExW(
            0x00040000,
            class_name.as_ptr(),
            wide("Connect|API — Deployer | Interface gráfica").as_ptr(),
            0x10ca0000,
            0x80000000u32 as i32,
            0x80000000u32 as i32,
            870,
            750,
            null_mut(),
            null_mut(),
            instance,
            null_mut(),
        );
        if hwnd.is_null() {
            show_error("Não foi possível criar a janela do Deployer.");
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

fn show_error(text: &str) {
    unsafe {
        MessageBoxW(
            null_mut(),
            wide(text).as_ptr(),
            wide("Connect|API — Deployer").as_ptr(),
            0x10,
        );
    }
}
