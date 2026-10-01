use std::{
    collections::HashSet,
    env,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

mod templates {
    include!(concat!(env!("OUT_DIR"), "/templates.rs"));
}

#[cfg(windows)]
#[link(name = "bcrypt")]
extern "system" {
    fn BCryptGenRandom(
        algorithm: *mut std::ffi::c_void,
        buffer: *mut u8,
        length: u32,
        flags: u32,
    ) -> i32;
}

const MODULE_ORDER: &[&str] = &["operations", "nats", "kafka", "extended", "mysql", "traccar"];
const SECRET_KEYS: &[&str] = &[
    "METRICS_PASSWORD",
    "POSTGRES_PASSWORD",
    "MYSQL_PASSWORD",
    "MYSQL_ROOT_PASSWORD",
    "REDIS_PASSWORD",
    "RABBITMQ_DEFAULT_PASS",
    "S3_SECRET_KEY",
    "MINIO_ROOT_PASSWORD",
    "AUTHENTICATION_API_KEY",
    "OPERATIONS_INTERNAL_TOKEN",
    "FINDHUB_CREDENTIALS_KEY",
    "TRACCAR_ADMIN_PASSWORD",
    "TRACCAR_DATABASE_PASSWORD",
];

const USAGE: &str = r#"Connect|API Deployer (Rust nativo)

Uso:
  argws-connect-deployer list
  argws-connect-deployer plan --flavor develop --modules operations,traccar
  argws-connect-deployer generate --flavor develop --modules operations,traccar --output ./stack
  argws-connect-deployer validate --directory ./stack

Opcoes:
  --flavor <nome>              develop, homologation, production, canonical, dockge ou cloudpanel
  --modules <lista>            operations,nats,kafka,extended,mysql,traccar
  --output <diretorio>         destino do compose.yaml e .env
  --directory <diretorio>      stack existente para validar
  --from-env <arquivo>         importa um .env existente sem reordenar variaveis
  --traccar-auth <modo>        credentials (padrao) ou token
  --traccar-token <token>      token Traccar existente; nunca a chave da API
  --traccar-admin-email <email> email administrativo do Traccar
  --server-url <url>           sobrescreve SERVER_URL
  --docs-url <url>             sobrescreve ARGWS_CONNECT_DOCS_PUBLIC_URL
  --project-name <nome>        sobrescreve COMPOSE_PROJECT_NAME
  --set KEY=VALUE              sobrescreve uma variavel; pode ser repetido
  --force                      permite substituir compose.yaml e .env existentes
  --json                       imprime o plano em JSON
  --help                       mostra esta ajuda

O executavel e compilado em Rust e nao inclui Node.js, Python ou outro runtime.
O gerador cria somente compose.yaml e .env. No modo credentials, TRACCAR_TOKEN fica vazio.
"#;

#[derive(Debug, Default)]
struct Options {
    command: String,
    flavor: Option<String>,
    modules: Option<String>,
    output: Option<String>,
    directory: Option<String>,
    from_env: Option<String>,
    traccar_auth: Option<String>,
    traccar_token: Option<String>,
    traccar_admin_email: Option<String>,
    server_url: Option<String>,
    docs_url: Option<String>,
    project_name: Option<String>,
    sets: Vec<String>,
    force: bool,
    json: bool,
}

#[derive(Clone, Debug, Default)]
struct EnvValues {
    entries: Vec<(String, String)>,
}

impl EnvValues {
    fn get(&self, key: &str) -> String {
        self.entries
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.clone())
            .unwrap_or_default()
    }

    fn set(&mut self, key: &str, value: impl Into<String>) {
        let value = value.into();
        if let Some((_, current)) = self.entries.iter_mut().find(|(name, _)| name == key) {
            *current = value;
        } else {
            self.entries.push((key.to_string(), value));
        }
    }
}

#[derive(Debug)]
struct BuildResult {
    flavor: String,
    channel: String,
    modules: Vec<String>,
    profiles: String,
    compose: String,
    env: String,
    generated_secrets: Vec<String>,
    traccar_authentication: String,
}

fn valid_name(value: &str) -> bool {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) if first == '_' || first.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}

fn parse_args(args: &[String]) -> Result<Options, String> {
    let command = args.first().cloned().unwrap_or_else(|| "help".to_string());
    if !matches!(command.as_str(), "list" | "plan" | "generate" | "validate" | "help" | "--help" | "-h") {
        return Err(format!("comando desconhecido: {command}\n\n{USAGE}"));
    }
    let mut options = Options {
        command: if matches!(command.as_str(), "--help" | "-h") {
            "help".to_string()
        } else {
            command
        },
        ..Options::default()
    };
    let mut index = 1usize;
    while index < args.len() {
        let item = args[index].as_str();
        match item {
            "--help" | "-h" => options.command = "help".to_string(),
            "--json" => options.json = true,
            "--force" => options.force = true,
            "--flavor" => options.flavor = Some(next_value(args, &mut index, item)?),
            "--modules" => options.modules = Some(next_value(args, &mut index, item)?),
            "--output" => options.output = Some(next_value(args, &mut index, item)?),
            "--directory" => options.directory = Some(next_value(args, &mut index, item)?),
            "--from-env" => options.from_env = Some(next_value(args, &mut index, item)?),
            "--traccar-auth" => options.traccar_auth = Some(next_value(args, &mut index, item)?),
            "--traccar-token" => options.traccar_token = Some(next_value(args, &mut index, item)?),
            "--traccar-admin-email" => options.traccar_admin_email = Some(next_value(args, &mut index, item)?),
            "--server-url" => options.server_url = Some(next_value(args, &mut index, item)?),
            "--docs-url" => options.docs_url = Some(next_value(args, &mut index, item)?),
            "--project-name" => options.project_name = Some(next_value(args, &mut index, item)?),
            "--set" => options.sets.push(next_value(args, &mut index, item)?),
            other => return Err(format!("opcao desconhecida: {other}\n\n{USAGE}")),
        }
        index += 1;
    }
    Ok(options)
}

fn next_value(args: &[String], index: &mut usize, flag: &str) -> Result<String, String> {
    *index += 1;
    let value = args.get(*index).cloned().unwrap_or_default();
    if value.is_empty() || value.starts_with("--") {
        return Err(format!("{flag} exige um valor"));
    }
    Ok(value)
}

fn parse_env(text: &str) -> EnvValues {
    let mut values = EnvValues::default();
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        let Some((key, value)) = line.trim_start().split_once('=') else {
            continue;
        };
        if valid_name(key) {
            values.set(key, value.to_string());
        }
    }
    values
}

fn line_key(line: &str) -> Option<(usize, &str)> {
    let start = line.len() - line.trim_start().len();
    let rest = &line[start..];
    let (key, _) = rest.split_once('=')?;
    valid_name(key).then_some((start, key))
}

fn set_env(text: &str, values: &EnvValues) -> String {
    let trailing_newline = text.ends_with('\n');
    let mut lines: Vec<&str> = text.split('\n').collect();
    if trailing_newline {
        lines.pop();
    }
    let mut pending = values.entries.clone();
    let mut output = Vec::with_capacity(lines.len() + pending.len());
    for line in lines {
        let normalized = line.trim_end_matches('\r');
        if let Some((start, key)) = line_key(normalized) {
            if let Some(position) = pending.iter().position(|(name, _)| name == key) {
                let value = pending.remove(position).1;
                output.push(format!("{}{}={value}", &normalized[..start], key));
                continue;
            }
        }
        output.push(normalized.to_string());
    }
    output.extend(pending.into_iter().map(|(key, value)| format!("{key}={value}")));
    let mut result = output.join("\n");
    if trailing_newline {
        result.push('\n');
    }
    result
}

fn is_placeholder(value: &str) -> bool {
    let value = value.trim();
    value.is_empty() || value.starts_with("CHANGE_ME")
}

fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::with_capacity((bytes.len() * 4).div_ceil(3));
    let mut index = 0;
    while index < bytes.len() {
        let a = bytes[index] as u32;
        let b = bytes.get(index + 1).copied().unwrap_or(0) as u32;
        let c = bytes.get(index + 2).copied().unwrap_or(0) as u32;
        let triple = (a << 16) | (b << 8) | c;
        output.push(ALPHABET[((triple >> 18) & 63) as usize] as char);
        output.push(ALPHABET[((triple >> 12) & 63) as usize] as char);
        if index + 1 < bytes.len() {
            output.push(ALPHABET[((triple >> 6) & 63) as usize] as char);
        }
        if index + 2 < bytes.len() {
            output.push(ALPHABET[(triple & 63) as usize] as char);
        }
        index += 3;
    }
    output
}

fn secret() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    secure_random(&mut bytes)?;
    Ok(base64url(&bytes))
}

fn secure_random(bytes: &mut [u8]) -> Result<(), String> {
    #[cfg(windows)]
    {
        // BCRYPT_USE_SYSTEM_PREFERRED_RNG: the OS-backed CSPRNG, no provider handle.
        let status = unsafe { BCryptGenRandom(std::ptr::null_mut(), bytes.as_mut_ptr(), bytes.len() as u32, 0x00000002) };
        if status != 0 {
            return Err(format!("nao foi possivel gerar segredo seguro (BCryptGenRandom: 0x{status:08x})"));
        }
        return Ok(());
    }
    #[cfg(unix)]
    {
        let mut source = fs::File::open("/dev/urandom").map_err(|error| format!("nao foi possivel abrir CSPRNG do sistema: {error}"))?;
        source.read_exact(bytes).map_err(|error| format!("nao foi possivel ler CSPRNG do sistema: {error}"))?;
        return Ok(());
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = bytes;
        Err("sistema operacional sem CSPRNG implementado".to_string())
    }
}

fn mark_generated(generated: &mut Vec<String>, key: &str) {
    if !generated.iter().any(|item| item == key) {
        generated.push(key.to_string());
    }
}

fn shared_secret(values: &mut EnvValues, keys: &[&str], generated: &mut Vec<String>) -> Result<(), String> {
    let existing = keys
        .iter()
        .map(|key| values.get(key))
        .find(|value| !is_placeholder(value));
    let value = match existing {
        Some(value) => value,
        None => secret()?,
    };
    for key in keys {
        if is_placeholder(&values.get(key)) {
            values.set(key, value.clone());
            mark_generated(generated, key);
        }
    }
    Ok(())
}

fn update_uri_password(values: &mut EnvValues, key: &str, placeholder: &str, password: &str) {
    let current = values.get(key);
    if current.is_empty() {
        return;
    }
    if current.contains(placeholder) {
        values.set(key, current.replace(placeholder, password));
        return;
    }
    if current.contains("CHANGE_ME") {
        values.set(key, current.replace("CHANGE_ME", password));
    }
}

fn parse_modules(raw: Option<&str>) -> Result<Vec<String>, String> {
    let raw = raw.unwrap_or("operations");
    let requested: Vec<_> = raw
        .split(',')
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect();
    if requested.len() == 1 && requested[0] == "none" {
        return Ok(Vec::new());
    }
    let mut selected = HashSet::new();
    for module in requested {
        if !MODULE_ORDER.contains(&module.as_str()) {
            return Err(format!(
                "modulo desconhecido: {module}. Opcoes: {}",
                MODULE_ORDER.join(", ")
            ));
        }
        selected.insert(module);
    }
    if selected.contains("extended") {
        selected.insert("nats".to_string());
        selected.insert("kafka".to_string());
    }
    Ok(MODULE_ORDER
        .iter()
        .filter(|module| selected.contains(**module))
        .map(|module| (*module).to_string())
        .collect())
}

fn compose_profiles(modules: &[String]) -> String {
    let mut profiles = Vec::new();
    for module in MODULE_ORDER {
        if *module != "extended" && modules.iter().any(|item| item == *module) {
            profiles.push((*module).to_string());
        }
    }
    if modules.iter().any(|item| item == "extended") {
        profiles.push("extended".to_string());
    }
    profiles.join(",")
}

fn template(flavor: &str) -> Result<(&'static str, &'static str, &'static str), String> {
    templates::TEMPLATES
        .iter()
        .find(|(name, _, _, _)| *name == flavor)
        .map(|(_, channel, compose, env)| (*channel, *compose, *env))
        .ok_or_else(|| {
            format!(
                "flavor desconhecido: {flavor}. Opcoes: {}",
                templates::TEMPLATES
                    .iter()
                    .map(|(name, _, _, _)| *name)
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })
}

fn build(options: &Options) -> Result<BuildResult, String> {
    let flavor = options.flavor.clone().unwrap_or_else(|| "develop".to_string());
    let (channel, compose, template_env) = template(&flavor)?;
    let env_text = match &options.from_env {
        Some(path) => fs::read_to_string(path).map_err(|error| format!("nao foi possivel ler {path}: {error}"))?,
        None => template_env.to_string(),
    };
    let modules = parse_modules(options.modules.as_deref())?;
    let profiles = compose_profiles(&modules);
    let mut values = parse_env(&env_text);
    let mut generated = Vec::new();

    values.set("COMPOSE_PROFILES", profiles.clone());
    values.set("OPERATIONS_ENABLED", if modules.iter().any(|item| item == "operations") { "true" } else { "false" });
    values.set("NATS_ENABLED", if modules.iter().any(|item| item == "nats") { "true" } else { "false" });
    values.set("KAFKA_ENABLED", if modules.iter().any(|item| item == "kafka") { "true" } else { "false" });
    values.set("MYSQL_SERVICE_ENABLED", if modules.iter().any(|item| item == "mysql") { "true" } else { "false" });
    values.set("TRACCAR_ENABLED", if modules.iter().any(|item| item == "traccar") { "true" } else { "false" });
    values.set("TRACCAR_MODE", if modules.iter().any(|item| item == "traccar") { "internal" } else { "disabled" });
    if let Some(value) = &options.server_url {
        values.set("SERVER_URL", value.clone());
    }
    if let Some(value) = &options.docs_url {
        values.set("ARGWS_CONNECT_DOCS_PUBLIC_URL", value.clone());
    }
    if let Some(value) = &options.project_name {
        values.set("COMPOSE_PROJECT_NAME", value.clone());
    }
    if let Some(value) = &options.traccar_admin_email {
        values.set("TRACCAR_ADMIN_EMAIL", value.clone());
    }

    shared_secret(&mut values, &["S3_SECRET_KEY", "MINIO_ROOT_PASSWORD"], &mut generated)?;
    shared_secret(&mut values, &["POSTGRES_PASSWORD"], &mut generated)?;
    shared_secret(&mut values, &["REDIS_PASSWORD"], &mut generated)?;
    shared_secret(&mut values, &["RABBITMQ_DEFAULT_PASS"], &mut generated)?;
    for key in SECRET_KEYS {
        let key = *key;
        if key == "OPERATIONS_INTERNAL_TOKEN" && !modules.iter().any(|item| item == "operations") {
            continue;
        }
        if key == "TRACCAR_ADMIN_PASSWORD" || key == "TRACCAR_DATABASE_PASSWORD" {
            continue;
        }
        if is_placeholder(&values.get(key)) {
            values.set(key, secret()?);
            mark_generated(&mut generated, key);
        }
    }

    let traccar_auth = options.traccar_auth.as_deref().unwrap_or("credentials");
    if !matches!(traccar_auth, "credentials" | "token") {
        return Err("--traccar-auth deve ser credentials ou token".to_string());
    }
    if modules.iter().any(|item| item == "operations") && is_placeholder(&values.get("OPERATIONS_INTERNAL_TOKEN")) {
        values.set("OPERATIONS_INTERNAL_TOKEN", secret()?);
        mark_generated(&mut generated, "OPERATIONS_INTERNAL_TOKEN");
    }
    if modules.iter().any(|item| item == "traccar") {
        for key in ["TRACCAR_ADMIN_PASSWORD", "TRACCAR_DATABASE_PASSWORD"] {
            if is_placeholder(&values.get(key)) {
                values.set(key, secret()?);
                mark_generated(&mut generated, key);
            }
        }
        if traccar_auth == "credentials" {
            values.set("TRACCAR_TOKEN", "");
        } else {
            let token = options
                .traccar_token
                .clone()
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| values.get("TRACCAR_TOKEN"));
            if token.is_empty() {
                return Err("modo token exige --traccar-token ou TRACCAR_TOKEN no .env importado".to_string());
            }
            if token == values.get("AUTHENTICATION_API_KEY") {
                return Err("TRACCAR_TOKEN nao pode ser igual a AUTHENTICATION_API_KEY; sao credenciais diferentes".to_string());
            }
            values.set("TRACCAR_TOKEN", token);
        }
    } else {
        values.set("TRACCAR_TOKEN", "");
    }

    let postgres_password = values.get("POSTGRES_PASSWORD");
    let redis_password = values.get("REDIS_PASSWORD");
    let rabbitmq_password = values.get("RABBITMQ_DEFAULT_PASS");
    update_uri_password(&mut values, "DATABASE_CONNECTION_URI", "CHANGE_ME_POSTGRES_PASSWORD", &postgres_password);
    update_uri_password(&mut values, "CACHE_REDIS_URI", "CHANGE_ME_REDIS_PASSWORD", &redis_password);
    update_uri_password(&mut values, "RABBITMQ_URI", "CHANGE_ME_RABBITMQ_PASSWORD", &rabbitmq_password);

    for assignment in &options.sets {
        let Some((key, value)) = assignment.split_once('=') else {
            return Err(format!("--set exige KEY=VALUE: {assignment}"));
        };
        if !valid_name(key) {
            return Err(format!("nome de variavel invalido em --set: {key}"));
        }
        values.set(key, value.to_string());
    }

    if modules.iter().any(|item| item == "traccar") && traccar_auth == "credentials" && !values.get("TRACCAR_TOKEN").is_empty() {
        return Err("TRACCAR_TOKEN esta preenchido, mas o modo credentials foi escolhido; use --traccar-auth token para importar um token existente".to_string());
    }
    if modules.iter().any(|item| item == "traccar") && traccar_auth == "token" && values.get("TRACCAR_TOKEN").is_empty() {
        return Err("modo token exige um TRACCAR_TOKEN valido".to_string());
    }
    if modules.iter().any(|item| item == "traccar")
        && values.get("TRACCAR_TOKEN") == values.get("AUTHENTICATION_API_KEY")
        && !values.get("TRACCAR_TOKEN").is_empty()
    {
        return Err("TRACCAR_TOKEN nao pode reutilizar AUTHENTICATION_API_KEY; sao credenciais diferentes".to_string());
    }

    let final_env = set_env(&env_text, &values);
    validate(compose, &final_env, &modules, &flavor)?;
    Ok(BuildResult {
        flavor,
        channel: channel.to_string(),
        modules,
        profiles,
        compose: compose.to_string(),
        env: final_env,
        generated_secrets: generated,
        traccar_authentication: if values.get("TRACCAR_TOKEN").is_empty() { "credentials" } else { "token" }.to_string(),
    })
}

fn has_compose_services(compose: &str) -> bool {
    compose.lines().any(|line| line.trim() == "services:")
}

fn has_compose_env_file(compose: &str) -> bool {
    let lines: Vec<_> = compose.lines().collect();
    lines.iter().enumerate().any(|(index, line)| {
        let value = line.trim();
        value == "env_file: [.env]"
            || value.starts_with("env_file: [.env,")
            || (value == "env_file:" && lines.get(index + 1).is_some_and(|next| next.trim() == "- .env"))
    })
}

fn validate(compose: &str, env_text: &str, modules: &[String], flavor: &str) -> Result<(), String> {
    let values = parse_env(env_text);
    let mut required: Vec<&str> = vec![
        "AUTHENTICATION_API_KEY",
        "METRICS_PASSWORD",
        "POSTGRES_PASSWORD",
        "REDIS_PASSWORD",
        "RABBITMQ_DEFAULT_PASS",
        "S3_SECRET_KEY",
        "MINIO_ROOT_PASSWORD",
        "FINDHUB_CREDENTIALS_KEY",
    ];
    if modules.iter().any(|item| item == "mysql") {
        required.extend(["MYSQL_PASSWORD", "MYSQL_ROOT_PASSWORD"]);
    }
    if modules.iter().any(|item| item == "operations") {
        required.push("OPERATIONS_INTERNAL_TOKEN");
    }
    if modules.iter().any(|item| item == "traccar") {
        required.extend(["TRACCAR_ADMIN_PASSWORD", "TRACCAR_DATABASE_PASSWORD"]);
    }
    let mut errors = Vec::new();
    for key in required {
        if is_placeholder(&values.get(key)) {
            errors.push(format!("{key} esta vazio ou usa CHANGE_ME"));
        }
    }
    let traccar_token = values.get("TRACCAR_TOKEN");
    if values.get("TRACCAR_ENABLED") == "true"
        && values.get("TRACCAR_MODE") == "internal"
        && !traccar_token.is_empty()
        && traccar_token == values.get("AUTHENTICATION_API_KEY")
    {
        errors.push("TRACCAR_TOKEN nao pode reutilizar AUTHENTICATION_API_KEY".to_string());
    }
    if modules.iter().any(|item| item == "traccar") && !compose.to_ascii_lowercase().contains("traccar") {
        errors.push("compose nao contem o servico Traccar".to_string());
    }
    if !has_compose_services(compose) {
        errors.push("compose.yaml nao contem services".to_string());
    }
    if !has_compose_env_file(compose) {
        errors.push("compose.yaml nao referencia .env".to_string());
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!("validacao falhou para {flavor}:\n- {}", errors.join("\n- ")))
    }
}

fn json_quote(value: &str) -> String {
    let mut output = String::from("\"");
    for character in value.chars() {
        match character {
            '\\' => output.push_str("\\\\"),
            '"' => output.push_str("\\\""),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            c if c.is_control() => output.push_str(&format!("\\u{:04x}", c as u32)),
            c => output.push(c),
        }
    }
    output.push('"');
    output
}

fn json_array(values: &[String]) -> String {
    format!(
        "[{}]",
        values
            .iter()
            .map(|value| json_quote(value))
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn plan_json(result: &BuildResult) -> String {
    format!(
        "{{\"flavor\":{},\"channel\":{},\"modules\":{},\"composeProfiles\":{},\"generatedFiles\":[\"compose.yaml\",\".env\"],\"traccarAuthentication\":{},\"generatedSecrets\":{}}}",
        json_quote(&result.flavor),
        json_quote(&result.channel),
        json_array(&result.modules),
        json_quote(&result.profiles),
        json_quote(&result.traccar_authentication),
        json_array(&result.generated_secrets)
    )
}

fn print_plan(result: &BuildResult, json: bool) {
    if json {
        println!("{}", plan_json(result));
        return;
    }
    println!("Flavor: {}", result.flavor);
    println!("Imagem: {}", result.channel);
    println!("Modulos: {}", if result.modules.is_empty() { "(somente base)".to_string() } else { result.modules.join(", ") });
    println!("Perfis Compose: {}", if result.profiles.is_empty() { "(nenhum)" } else { &result.profiles });
    println!("Arquivos: compose.yaml, .env");
    println!("Autenticacao Traccar: {}", result.traccar_authentication);
    println!("Segredos gerados: {}", if result.generated_secrets.is_empty() { "(nenhum; valores importados preservados)".to_string() } else { result.generated_secrets.join(", ") });
}

fn ensure_safe_output(directory: &Path, force: bool) -> Result<(), String> {
    if !force && (directory.join("compose.yaml").exists() || directory.join(".env").exists()) {
        return Err(format!(
            "o destino ja possui compose.yaml ou .env: {}. Use --from-env para importar e --force somente se deseja substituir",
            directory.display()
        ));
    }
    Ok(())
}

fn write_env(path: &Path, content: &str) -> Result<(), String> {
    #[cfg(unix)]
    let options = {
        use std::os::unix::fs::OpenOptionsExt;
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true).mode(0o600);
        options
    };
    #[cfg(not(unix))]
    let options = {
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        options
    };
    let mut file = options
        .open(path)
        .map_err(|error| format!("nao foi possivel criar {}: {error}", path.display()))?;
    file.write_all(content.as_bytes())
        .map_err(|error| format!("nao foi possivel escrever {}: {error}", path.display()))?;
    file.sync_all().map_err(|error| format!("nao foi possivel sincronizar {}: {error}", path.display()))
}

fn generate(result: &BuildResult, options: &Options) -> Result<PathBuf, String> {
    let output = options
        .output
        .as_deref()
        .ok_or_else(|| "generate exige --output <diretorio>".to_string())?;
    let directory = PathBuf::from(output);
    ensure_safe_output(&directory, options.force)?;
    fs::create_dir_all(&directory).map_err(|error| format!("nao foi possivel criar {}: {error}", directory.display()))?;
    fs::write(directory.join("compose.yaml"), result.compose.as_bytes())
        .map_err(|error| format!("nao foi possivel escrever compose.yaml: {error}"))?;
    write_env(&directory.join(".env"), &result.env)?;
    println!("Deploy preparado em {}", directory.display());
    println!("Arquivos gerados: compose.yaml, .env");
    Ok(directory)
}

fn validate_directory(options: &Options) -> Result<(), String> {
    let directory = options
        .directory
        .as_deref()
        .ok_or_else(|| "validate exige --directory <diretorio>".to_string())?;
    let directory = PathBuf::from(directory);
    let compose_path = directory.join("compose.yaml");
    let env_path = directory.join(".env");
    let compose = fs::read_to_string(&compose_path).map_err(|error| format!("nao foi possivel ler {}: {error}", compose_path.display()))?;
    let env_text = fs::read_to_string(&env_path).map_err(|error| format!("nao foi possivel ler {}: {error}", env_path.display()))?;
    let values = parse_env(&env_text);
    let modules = parse_modules(Some(&values.get("COMPOSE_PROFILES")))?;
    validate(&compose, &env_text, &modules, &directory.display().to_string())?;
    println!("OK: {}", directory.display());
    Ok(())
}

/// Flavors exposed by the native graphical deployer. The same templates are
/// also available through the CLI `list` command.
pub const GUI_FLAVORS: &[&str] = &[
    "develop",
    "homologation",
    "production",
    "canonical",
    "dockge",
    "cloudpanel",
];

/// Optional Compose profiles accepted by both deployer frontends.
pub const GUI_MODULES: &[&str] = &["operations", "nats", "kafka", "extended", "mysql", "traccar"];

#[derive(Clone, Debug)]
pub struct GuiGenerateRequest {
    pub flavor: String,
    pub modules: Vec<String>,
    pub output: PathBuf,
    pub from_env: Option<PathBuf>,
    pub traccar_auth: String,
    pub traccar_token: String,
    pub traccar_admin_email: String,
    pub server_url: String,
    pub docs_url: String,
    pub project_name: String,
    pub force: bool,
}

#[derive(Clone, Debug)]
pub struct GuiSummary {
    pub flavor: String,
    pub channel: String,
    pub modules: Vec<String>,
    pub profiles: String,
    pub output: PathBuf,
    pub traccar_authentication: String,
    pub generated_secrets: Vec<String>,
}

/// Prepare a stack through the same validated core used by the CLI, without
/// invoking a shell or requiring Node.js on the operator's machine.
pub fn gui_generate(request: GuiGenerateRequest) -> Result<GuiSummary, String> {
    let modules = if request.modules.is_empty() {
        "operations".to_string()
    } else {
        request.modules.join(",")
    };
    let options = Options {
        command: "generate".to_string(),
        flavor: Some(request.flavor),
        modules: Some(modules),
        output: Some(request.output.to_string_lossy().into_owned()),
        directory: None,
        from_env: request.from_env.map(|path| path.to_string_lossy().into_owned()),
        traccar_auth: Some(if request.traccar_auth.is_empty() {
            "credentials".to_string()
        } else {
            request.traccar_auth
        }),
        traccar_token: (!request.traccar_token.is_empty()).then_some(request.traccar_token),
        traccar_admin_email: (!request.traccar_admin_email.is_empty())
            .then_some(request.traccar_admin_email),
        server_url: (!request.server_url.is_empty()).then_some(request.server_url),
        docs_url: (!request.docs_url.is_empty()).then_some(request.docs_url),
        project_name: (!request.project_name.is_empty()).then_some(request.project_name),
        sets: Vec::new(),
        force: request.force,
        json: false,
    };
    let result = build(&options)?;
    let output = generate(&result, &options)?;
    Ok(GuiSummary {
        flavor: result.flavor,
        channel: result.channel,
        modules: result.modules,
        profiles: result.profiles,
        output,
        traccar_authentication: result.traccar_authentication,
        generated_secrets: result.generated_secrets,
    })
}

/// Validate a previously prepared stack through the same rules used by the
/// CLI, preserving the safe read-only behavior of `validate`.
pub fn gui_validate(directory: impl AsRef<Path>) -> Result<(), String> {
    let options = Options {
        command: "validate".to_string(),
        directory: Some(directory.as_ref().to_string_lossy().into_owned()),
        ..Options::default()
    };
    validate_directory(&options)
}

fn run(options: Options) -> Result<(), String> {
    match options.command.as_str() {
        "help" => {
            print!("{USAGE}");
            Ok(())
        }
        "list" => {
            println!("develop\nhomologation\nproduction\ncanonical\ndockge\ncloudpanel");
            println!("modulos: {}", MODULE_ORDER.join(", "));
            Ok(())
        }
        "validate" => validate_directory(&options),
        "plan" | "generate" => {
            let result = build(&options)?;
            if options.command == "generate" {
                generate(&result, &options)?;
            }
            print_plan(&result, options.json);
            Ok(())
        }
        command => Err(format!("comando nao implementado: {command}")),
    }
}

pub fn run_cli() {
    match parse_args(&env::args().skip(1).collect::<Vec<_>>()).and_then(run) {
        Ok(()) => {}
        Err(error) => {
            eprintln!("Erro: {error}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extended_enables_nats_and_kafka() {
        assert_eq!(parse_modules(Some("extended")).unwrap(), ["nats", "kafka", "extended"]);
        assert_eq!(compose_profiles(&["nats".to_string(), "kafka".to_string(), "extended".to_string()]), "nats,kafka,extended");
    }

    #[test]
    fn set_env_preserves_comments_and_order() {
        let mut values = EnvValues::default();
        values.set("FOO", "tres");
        values.set("NEW_VALUE", "quatro");
        assert_eq!(set_env("# cabecalho\nFOO=um\n\nBAR=dois\n", &values), "# cabecalho\nFOO=tres\n\nBAR=dois\nNEW_VALUE=quatro\n");
    }

    #[test]
    fn generated_secret_is_url_safe_without_padding() {
        let value = secret().unwrap();
        assert_eq!(value.len(), 43);
        assert!(value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn develop_template_builds_with_traccar() {
        let result = build(&Options { flavor: Some("develop".to_string()), modules: Some("operations,traccar".to_string()), ..Options::default() }).unwrap();
        let values = parse_env(&result.env);
        assert_eq!(values.get("COMPOSE_PROFILES"), "operations,traccar");
        assert_eq!(values.get("TRACCAR_MODE"), "internal");
        assert!(values.get("TRACCAR_TOKEN").is_empty());
        assert!(!values.get("TRACCAR_ADMIN_PASSWORD").is_empty());
        assert!(!values.get("TRACCAR_DATABASE_PASSWORD").is_empty());
    }
}
