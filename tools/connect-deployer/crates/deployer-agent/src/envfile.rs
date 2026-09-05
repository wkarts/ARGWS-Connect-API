use crate::error::{AgentError, Result};
use base64::Engine;
use rand::RngCore;
use regex::Regex;
use std::collections::{BTreeMap, BTreeSet};

const APP_IMAGES: &[&str] = &[
    "API",
    "DOCS",
    "PLATFORM_API",
    "PLATFORM_WEB",
    "PLATFORM_GATEWAY",
    "PLATFORM_ACME",
    "PLATFORM_CLOUDPANEL_AGENT",
    "PGBOUNCER",
];

pub fn env_values(text: &str) -> Result<BTreeMap<String, String>> {
    let key_re = Regex::new(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$")?;
    let mut result = BTreeMap::new();
    for raw in text.lines() {
        let mut line = raw.trim();
        if let Some(rest) = line.strip_prefix("export ") {
            line = rest;
        }
        let Some(caps) = key_re.captures(line) else {
            continue;
        };
        let key = caps.get(1).unwrap().as_str().to_string();
        let mut value = caps.get(2).unwrap().as_str().to_string();
        if result.contains_key(&key) {
            return Err(AgentError::msg(format!("Variável duplicada no .env: {key}")));
        }
        if value.len() >= 2 {
            let first = value.as_bytes()[0] as char;
            let last = value.as_bytes()[value.len() - 1] as char;
            if (first == '\'' || first == '"') && first == last {
                value = value[1..value.len() - 1].to_string();
            }
        }
        result.insert(key, value);
    }
    Ok(result)
}

pub fn set_env(text: &str, key: &str, value: &str) -> Result<String> {
    if value.chars().any(|c| matches!(c, '\r' | '\n' | '\0')) || value.contains('\'') {
        return Err(AgentError::msg(format!("Valor inválido para {key}")));
    }
    let safe = Regex::new(r"^[A-Za-z0-9_./:@,?=+*\-]*$")?;
    let literal = if safe.is_match(value) {
        value.to_string()
    } else {
        format!("'{value}'")
    };
    let pattern = Regex::new(&format!(r"(?m)^(?:export )?{}=.*$", regex::escape(key)))?;
    if pattern.is_match(text) {
        Ok(pattern
            .replace_all(text, format!("{key}={literal}").as_str())
            .into_owned())
    } else {
        Ok(format!("{}\n{key}={literal}\n", text.trim_end_matches('\n')))
    }
}

pub fn prepare_env(
    template: &str,
    existing: Option<&str>,
    tag: &str,
    profiles: &[String],
) -> Result<(String, Vec<String>)> {
    let placeholder_re = Regex::new(r"CHANGE_ME[A-Za-z0-9_]*")?;
    let mut text = existing.unwrap_or(template).to_string();

    if existing.is_none() {
        let markers: BTreeSet<String> = placeholder_re
            .find_iter(&text)
            .map(|m| m.as_str().to_string())
            .collect();
        let mut replacements = BTreeMap::new();
        for marker in markers {
            let replacement = if marker.contains("ENCRYPTION_KEY") {
                let mut bytes = [0u8; 32];
                rand::rng().fill_bytes(&mut bytes);
                base64::engine::general_purpose::URL_SAFE.encode(bytes)
            } else {
                let mut bytes = [0u8; 32];
                rand::rng().fill_bytes(&mut bytes);
                hex::encode(bytes)
            };
            replacements.insert(marker, replacement);
        }
        for (marker, replacement) in replacements {
            text = text.replace(&marker, &replacement);
        }
    }

    let before = env_values(&text)?;
    if before.get("COMPOSE_FILE").is_some_and(|v| v != "compose.yaml") {
        return Err(AgentError::msg(
            "COMPOSE_FILE aponta para outra configuração; não será migrado silenciosamente.",
        ));
    }

    if existing.is_some() {
        for (key, value) in env_values(template)? {
            if !before.contains_key(&key) {
                if placeholder_re.is_match(&value) {
                    return Err(AgentError::msg(format!(
                        "A atualização requer credencial ausente: {key}. Configure-a no .env existente."
                    )));
                }
                text = set_env(&text, &key, &value)?;
            }
        }
    }

    let values = env_values(&text)?;
    for component in APP_IMAGES {
        let key = format!("ARGWS_CONNECT_{component}_IMAGE");
        if let Some(image) = values.get(&key) {
            let mut repo = image.split('@').next().unwrap_or(image).to_string();
            if let Some(last_slash) = repo.rfind('/') {
                let tail = &repo[last_slash + 1..];
                if let Some(colon) = tail.rfind(':') {
                    repo.truncate(last_slash + 1 + colon);
                }
            } else if let Some(colon) = repo.rfind(':') {
                repo.truncate(colon);
            }
            if !Regex::new(r"^[a-zA-Z0-9./_-]+$")?.is_match(&repo) {
                return Err(AgentError::msg(format!("Imagem inválida em {key}")));
            }
            text = set_env(&text, &key, &format!("{repo}:{tag}"))?;
        }
    }

    if !profiles.is_empty() {
        text = set_env(&text, "COMPOSE_PROFILES", &profiles.join(","))?;
    }
    let values = env_values(&text)?;
    if values.contains_key("CONNECT_API_VERSION") && tag != "develop" {
        text = set_env(&text, "CONNECT_API_VERSION", tag)?;
    }
    if placeholder_re.is_match(&text) {
        return Err(AgentError::msg(
            "O .env contém placeholders CHANGE_ME; atualização bloqueada para proteger credenciais.",
        ));
    }
    let after = env_values(&text)?;
    let changes = after
        .iter()
        .filter_map(|(key, value)| (before.get(key) != Some(value)).then(|| key.clone()))
        .collect();
    Ok((text, changes))
}

pub fn apply_platform_inputs(
    mut text: String,
    platform_admin_email: Option<&str>,
    platform_domain: Option<&str>,
    acme_email: Option<&str>,
    cloudflare_api_token: Option<&str>,
    cloudflare_target: Option<&str>,
) -> Result<String> {
    if let Some(value) = platform_admin_email.filter(|v| !v.trim().is_empty()) {
        text = set_env(&text, "PLATFORM_ADMIN_EMAIL", value.trim())?;
    }
    if let Some(value) = platform_domain.filter(|v| !v.trim().is_empty()) {
        let root = value.trim().to_ascii_lowercase();
        if !Regex::new(r"^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$")?.is_match(&root)
            || !root.contains('.')
        {
            return Err(AgentError::msg("Domínio base inválido."));
        }
        text = set_env(&text, "PLATFORM_DOMAIN", &root)?;
        let hosts = [
            ("CONTROL_PLANE_HOST", "control"),
            ("ADMIN_HOST", "admin"),
            ("PARTNER_PLANE_HOST", "partner"),
            ("API_HOST", "api"),
            ("DOCS_HOST", "docs"),
            ("DEMO_HOST", "demo"),
        ];
        let mut resolved = Vec::new();
        for (key, prefix) in hosts {
            let host = format!("{prefix}.{root}");
            text = set_env(&text, key, &host)?;
            resolved.push(host);
        }
        for key in ["TENANT_DOMAIN_ROOT", "ACME_DOMAIN", "CLOUDPANEL_SITE_DOMAIN"] {
            text = set_env(&text, key, &root)?;
        }
        text = set_env(&text, "CLOUDPANEL_WILDCARD_DOMAIN", &format!("*.{root}"))?;
        text = set_env(&text, "CLOUDFLARE_TENANT_RECORD_TARGET", &root)?;
        let mut trusted = vec![root.clone(), format!(".{root}"), "localhost".into(), "127.0.0.1".into()];
        trusted.extend(resolved.iter().cloned());
        text = set_env(&text, "PLATFORM_TRUSTED_HOSTS", &trusted.join(","))?;
        let mut cors = vec![format!("https://{root}")];
        cors.extend(resolved.iter().map(|h| format!("https://{h}")));
        text = set_env(&text, "PLATFORM_CORS_ORIGINS", &cors.join(","))?;
        if let Some(api_host) = resolved.iter().find(|h| h.starts_with("api.")) {
            text = set_env(&text, "SERVER_URL", &format!("https://{api_host}"))?;
        }
        if let Some(docs_host) = resolved.iter().find(|h| h.starts_with("docs.")) {
            text = set_env(
                &text,
                "ARGWS_CONNECT_DOCS_PUBLIC_URL",
                &format!("https://{docs_host}"),
            )?;
        }
    }
    if let Some(value) = acme_email.filter(|v| !v.trim().is_empty()) {
        text = set_env(&text, "ACME_EMAIL", value.trim())?;
    }
    if let Some(value) = cloudflare_api_token.filter(|v| !v.trim().is_empty()) {
        text = set_env(&text, "CLOUDFLARE_API_TOKEN", value.trim())?;
    }
    if let Some(value) = cloudflare_target.filter(|v| !v.trim().is_empty()) {
        text = set_env(&text, "CLOUDFLARE_TENANT_RECORD_TARGET", value.trim())?;
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_existing_secret_and_updates_image_tag() {
        let template = "COMPOSE_PROJECT_NAME=test\nAPP_SECRET_KEY=CHANGE_ME_SECRET\nARGWS_CONNECT_API_IMAGE=ghcr.io/wkarts/api:old\n";
        let existing = "COMPOSE_PROJECT_NAME=test\nAPP_SECRET_KEY=keep-me\nARGWS_CONNECT_API_IMAGE=ghcr.io/wkarts/api:old\n";
        let (result, _) = prepare_env(template, Some(existing), "1.2.3", &[]).unwrap();
        let values = env_values(&result).unwrap();
        assert_eq!(values.get("APP_SECRET_KEY").unwrap(), "keep-me");
        assert_eq!(values.get("ARGWS_CONNECT_API_IMAGE").unwrap(), "ghcr.io/wkarts/api:1.2.3");
    }

    #[test]
    fn rejects_duplicate_env_key() {
        let result = env_values("A=1\nA=2\n");
        assert!(result.is_err());
    }

    #[test]
    fn domain_input_updates_platform_hosts() {
        let result = apply_platform_inputs(
            "COMPOSE_PROJECT_NAME=test\n".into(),
            None,
            Some("connect.example.com"),
            None,
            None,
            None,
        )
        .unwrap();
        let values = env_values(&result).unwrap();
        assert_eq!(values.get("API_HOST").unwrap(), "api.connect.example.com");
        assert_eq!(values.get("CLOUDPANEL_WILDCARD_DOMAIN").unwrap(), "*.connect.example.com");
    }
}
