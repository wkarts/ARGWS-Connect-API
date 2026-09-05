use crate::error::{AgentError, Result};
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use regex::Regex;
use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use serde_json::Value;
use sha1::{Digest, Sha1};
use std::collections::BTreeMap;
use std::time::Duration;
use zeroize::Zeroizing;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const PATH_SEGMENT: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'!')
    .add(b'"')
    .add(b'#')
    .add(b'$')
    .add(b'%')
    .add(b'&')
    .add(b'\'')
    .add(b'(')
    .add(b')')
    .add(b'*')
    .add(b'+')
    .add(b',')
    .add(b':')
    .add(b';')
    .add(b'<')
    .add(b'=')
    .add(b'>')
    .add(b'?')
    .add(b'@')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

pub struct GitHubSource {
    repo: String,
    token: Option<Zeroizing<String>>,
    client: Client,
    pub proofs: BTreeMap<String, String>,
}

impl GitHubSource {
    pub fn new(repo: &str, token: Option<String>) -> Result<Self> {
        let repo = normalize_repository(repo)?;
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .build()?;
        Ok(Self {
            repo,
            token: token.map(Zeroizing::new),
            client,
            proofs: BTreeMap::new(),
        })
    }

    pub fn repo(&self) -> &str {
        &self.repo
    }

    fn get(&self, suffix: &str) -> Result<Value> {
        let url = format!("https://api.github.com/repos/{}/{}", self.repo, suffix);
        let mut request = self
            .client
            .get(url)
            .header(ACCEPT, "application/vnd.github+json")
            .header(USER_AGENT, format!("Connect-Installer-Rust/{VERSION}"))
            .header("X-GitHub-Api-Version", "2022-11-28");
        if let Some(token) = &self.token {
            request = request.header(AUTHORIZATION, format!("Bearer {}", token.as_str()));
        }
        let response = request.send()?;
        let status = response.status();
        let bytes = response.bytes()?;
        if bytes.len() > 4_000_000 {
            return Err(AgentError::msg("Arquivo/resposta excede o limite do instalador."));
        }
        if !status.is_success() {
            return Err(AgentError::msg(format!(
                "GitHub HTTP {}: confira acesso, versão e existência do arquivo. Para repositório privado configure o token GitHub.",
                status.as_u16()
            )));
        }
        let value: Value = serde_json::from_slice(&bytes)?;
        if !value.is_object() {
            return Err(AgentError::msg("Resposta GitHub inválida."));
        }
        Ok(value)
    }

    pub fn resolve(&self, requested: &str, environment: &str) -> Result<(String, String)> {
        let semver = Regex::new(r"^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")?;
        let (reference, tag) = if requested == "develop" {
            if environment != "develop" {
                return Err(AgentError::msg("Produção não pode usar a versão develop."));
            }
            ("develop".to_string(), "develop".to_string())
        } else {
            let mut selected = requested.to_string();
            if requested == "latest" || requested == "production" {
                let release = self.get("releases/latest")?;
                ensure_stable_release(&release)?;
                selected = release
                    .get("tag_name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
            }
            if !semver.is_match(&selected) {
                return Err(AgentError::msg(
                    "Versão deve ser develop, latest ou SemVer estável, por exemplo v1.2.3.",
                ));
            }
            let tag = selected.strip_prefix('v').unwrap_or(&selected).to_string();
            let reference = format!("v{tag}");
            let release = self.get(&format!(
                "releases/tags/{}",
                utf8_percent_encode(&reference, PATH_SEGMENT)
            ))?;
            ensure_stable_release(&release)?;
            (reference, tag)
        };

        let commit = self.get(&format!(
            "commits/{}",
            utf8_percent_encode(&reference, PATH_SEGMENT)
        ))?;
        let sha = commit
            .get("sha")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !Regex::new(r"^[a-f0-9]{40}$")?.is_match(sha) {
            return Err(AgentError::msg("SHA Git inválido."));
        }
        Ok((sha.to_string(), tag))
    }

    pub fn file(&mut self, path: &str, sha: &str) -> Result<String> {
        if path.starts_with('/') || path.split('/').any(|part| part == "..") {
            return Err(AgentError::msg("Caminho de fonte inválido."));
        }
        let encoded_path = path
            .split('/')
            .map(|part| utf8_percent_encode(part, PATH_SEGMENT).to_string())
            .collect::<Vec<_>>()
            .join("/");
        let item = self.get(&format!("contents/{encoded_path}?ref={sha}"))?;
        if item.get("type").and_then(Value::as_str) != Some("file")
            || item.get("encoding").and_then(Value::as_str) != Some("base64")
        {
            return Err(AgentError::msg(
                "A fonte deve ser um arquivo regular UTF-8; links não são aceitos.",
            ));
        }
        let content = item
            .get("content")
            .and_then(Value::as_str)
            .ok_or_else(|| AgentError::msg("Conteúdo GitHub ausente."))?
            .replace('\r', "")
            .replace('\n', "");
        use base64::Engine;
        let data = base64::engine::general_purpose::STANDARD
            .decode(content)
            .map_err(|_| AgentError::msg("Arquivo GitHub Base64 inválido."))?;

        let mut hasher = Sha1::new();
        hasher.update(format!("blob {}\0", data.len()).as_bytes());
        hasher.update(&data);
        let digest = hex::encode(hasher.finalize());
        if item.get("sha").and_then(Value::as_str) != Some(digest.as_str()) {
            return Err(AgentError::msg("Integridade do arquivo Git divergente."));
        }
        self.proofs.insert(path.to_string(), digest);
        String::from_utf8(data).map_err(|_| AgentError::msg("Arquivo GitHub não está em UTF-8."))
    }
}

fn ensure_stable_release(value: &Value) -> Result<()> {
    if value.get("draft").and_then(Value::as_bool).unwrap_or(false)
        || value
            .get("prerelease")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return Err(AgentError::msg("A versão selecionada não é uma release estável publicada."));
    }
    Ok(())
}

fn normalize_repository(value: &str) -> Result<String> {
    let mut repo = value.trim().to_string();
    if repo.starts_with("https://") {
        let parsed = url::Url::parse(&repo).map_err(|_| AgentError::msg("URL GitHub inválida."))?;
        if parsed.host_str() != Some("github.com")
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.port().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return Err(AgentError::msg(
                "Use owner/repo ou URL HTTPS do github.com, sem credenciais na URL.",
            ));
        }
        repo = parsed.path().trim_matches('/').trim_end_matches(".git").to_string();
    }
    let valid = Regex::new(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")?;
    if !valid.is_match(&repo) || repo.contains("..") {
        return Err(AgentError::msg("Repositório inválido; use owner/repo."));
    }
    Ok(repo)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_normalization_accepts_expected_formats() {
        assert_eq!(normalize_repository("wkarts/ARGWS-Connect-API").unwrap(), "wkarts/ARGWS-Connect-API");
        assert_eq!(
            normalize_repository("https://github.com/wkarts/ARGWS-Connect-API.git").unwrap(),
            "wkarts/ARGWS-Connect-API"
        );
    }

    #[test]
    fn repository_normalization_rejects_credentials_and_traversal() {
        assert!(normalize_repository("https://user:token@github.com/wkarts/repo").is_err());
        assert!(normalize_repository("wkarts/../repo").is_err());
    }
}
