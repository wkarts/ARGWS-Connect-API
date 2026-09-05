<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { confirm, open } from '@tauri-apps/plugin-dialog';
import type {
  AgentEvent,
  ConnectionInput,
  ConnectionTestResult,
  DeployRequest,
  DesktopDeployRequest,
  Environment,
} from './types/deployer';

const connection = reactive<ConnectionInput>({
  host: '',
  port: 22,
  user: 'root',
  auth_method: 'key',
  key_file: null,
  key_passphrase: null,
  password: null,
  known_hosts_file: null,
  accept_new_host_key: false,
  sudo: false,
  connect_timeout_seconds: 20,
});

const deploy = reactive<DeployRequest>({
  protocol_version: 1,
  repository: 'wkarts/ARGWS-Connect-API',
  environment: 'production',
  version: 'latest',
  deployment: 'platform-production',
  directory: '/opt/stacks/argws-connect-platform-production',
  action: 'plan',
  platform_admin_email: null,
  platform_domain: null,
  acme_email: null,
  cloudflare_api_token: null,
  cloudflare_tenant_record_target: null,
  github_token: null,
  registry_user: null,
  registry_token: null,
  env_input: null,
  accept_host_agent: false,
  install_dockge: false,
  accept_docker_socket: false,
  dockge_directory: '/opt/dockge',
  wait_seconds: 180,
});

const envInputPath = ref<string | null>(null);
const testing = ref(false);
const deploying = ref(false);
const testResult = ref<ConnectionTestResult | null>(null);
const lastResult = ref<unknown>(null);
const errorMessage = ref('');
const progress = ref(0);
const logs = ref<AgentEvent[]>([]);
const agentStatus = ref<Record<string, unknown> | null>(null);
let unlisten: UnlistenFn | null = null;

const isProduction = computed(() => deploy.environment === 'production');
const agentsEmbedded = computed(() => {
  const value = agentStatus.value as { amd64?: { embedded?: boolean }; arm64?: { embedded?: boolean } } | null;
  return Boolean(value?.amd64?.embedded && value?.arm64?.embedded);
});
const canDeploy = computed(() => {
  const authReady =
    connection.auth_method === 'agent' ||
    (connection.auth_method === 'key' && Boolean(connection.key_file)) ||
    (connection.auth_method === 'password' && Boolean(connection.password));
  const dockgeReady = !deploy.install_dockge || deploy.accept_docker_socket;
  const productionReady = deploy.environment !== 'production' || deploy.version !== 'develop';
  return Boolean(
    connection.host &&
      connection.user &&
      authReady &&
      deploy.repository &&
      deploy.version &&
      deploy.deployment &&
      deploy.directory &&
      dockgeReady &&
      productionReady &&
      !deploying.value,
  );
});

watch(
  () => deploy.environment,
  (environment: Environment) => {
    if (environment === 'production') {
      deploy.version = 'latest';
      deploy.deployment = 'platform-production';
      deploy.directory = '/opt/stacks/argws-connect-platform-production';
    } else {
      deploy.version = 'develop';
      deploy.deployment = 'platform-develop';
      deploy.directory = '/opt/stacks/argws-connect-platform-develop';
    }
    testResult.value = null;
  },
);

watch(
  () => deploy.install_dockge,
  (enabled) => {
    if (!enabled) deploy.accept_docker_socket = false;
  },
);

async function selectKeyFile() {
  const result = await open({
    multiple: false,
    directory: false,
    title: 'Selecione a chave SSH privada',
  });
  if (typeof result === 'string') connection.key_file = result;
}

async function selectEnvFile() {
  const result = await open({
    multiple: false,
    directory: false,
    title: 'Selecione o .env inicial',
    filters: [{ name: 'Environment', extensions: ['env', 'example', 'txt'] }],
  });
  if (typeof result === 'string') envInputPath.value = result;
}

function clearSecrets() {
  connection.password = null;
  connection.key_passphrase = null;
  deploy.github_token = null;
  deploy.registry_token = null;
  deploy.cloudflare_api_token = null;
}

async function testServer() {
  testing.value = true;
  errorMessage.value = '';
  testResult.value = null;
  try {
    testResult.value = await invoke<ConnectionTestResult>('test_connection', { input: { ...connection } });
  } catch (error) {
    errorMessage.value = String(error);
  } finally {
    testing.value = false;
  }
}

async function startDeploy() {
  if (deploy.action === 'apply') {
    const confirmed = await confirm(
      `Implantar ${deploy.deployment} (${deploy.environment}) em ${connection.host}?\n\nO Deployer fará pull das imagens e executará docker compose up no VPS.`,
      { title: 'Confirmar implantação', kind: 'warning' },
    );
    if (!confirmed) return;
  }
  deploying.value = true;
  errorMessage.value = '';
  logs.value = [];
  progress.value = 0;
  lastResult.value = null;

  const input: DesktopDeployRequest = {
    connection: { ...connection },
    deploy: { ...deploy, env_input: null },
    env_input_path: envInputPath.value,
  };

  try {
    lastResult.value = await invoke('deploy', { input });
    progress.value = 100;
  } catch (error) {
    errorMessage.value = String(error);
  } finally {
    deploying.value = false;
  }
}

function formatBytes(value?: number | null): string {
  if (!value) return '—';
  const gb = value / 1024 / 1024 / 1024;
  return `${gb.toFixed(1)} GB`;
}

function logClass(kind: AgentEvent['kind']): string {
  return `log-${kind}`;
}

onMounted(async () => {
  unlisten = await listen<AgentEvent>('deploy-event', (event) => {
    logs.value.push(event.payload);
    if (typeof event.payload.progress === 'number') progress.value = event.payload.progress;
    if (event.payload.kind === 'result') lastResult.value = event.payload.data;
  });
  try {
    agentStatus.value = await invoke<Record<string, unknown>>('embedded_agent_status');
  } catch {
    agentStatus.value = null;
  }
});

onBeforeUnmount(() => {
  unlisten?.();
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div>
        <div class="brand-line"><strong>ARGWS</strong> Connect|API</div>
        <h1>Deployer</h1>
        <p>Implantação SSH em VPS Linux sem Python remoto.</p>
      </div>
      <div class="topbar-badges">
        <span class="badge">Tauri 2</span>
        <span class="badge">Rust</span>
        <span class="badge success">Agent Linux</span>
      </div>
    </header>

    <main class="layout">
      <section class="left-column">
        <article class="card">
          <div class="card-heading">
            <div>
              <span class="eyebrow">01</span>
              <h2>Conexão SSH</h2>
            </div>
            <button class="secondary" :disabled="testing || deploying" @click="testServer">
              {{ testing ? 'Testando…' : 'Testar servidor' }}
            </button>
          </div>

          <div class="grid grid-3">
            <label class="field field-span-2">
              <span>Host / IP</span>
              <input v-model.trim="connection.host" placeholder="203.0.113.10" autocomplete="off" />
            </label>
            <label class="field">
              <span>Porta</span>
              <input v-model.number="connection.port" type="number" min="1" max="65535" />
            </label>
            <label class="field">
              <span>Usuário</span>
              <input v-model.trim="connection.user" autocomplete="username" />
            </label>
            <label class="field">
              <span>Autenticação</span>
              <select v-model="connection.auth_method">
                <option value="key">Chave SSH</option>
                <option value="agent">SSH Agent</option>
                <option value="password">Senha</option>
              </select>
            </label>
            <label class="check-field">
              <input v-model="connection.sudo" type="checkbox" />
              <span>Executar agente com <code>sudo -n</code></span>
            </label>
          </div>

          <div v-if="connection.auth_method === 'key'" class="grid grid-2 nested-panel">
            <label class="field">
              <span>Chave privada</span>
              <div class="input-action">
                <input :value="connection.key_file || ''" readonly placeholder="id_ed25519" />
                <button class="ghost" type="button" @click="selectKeyFile">Selecionar</button>
              </div>
            </label>
            <label class="field">
              <span>Passphrase da chave</span>
              <input v-model="connection.key_passphrase" type="password" autocomplete="new-password" placeholder="Opcional" />
            </label>
          </div>

          <div v-if="connection.auth_method === 'password'" class="nested-panel">
            <label class="field">
              <span>Senha SSH</span>
              <input v-model="connection.password" type="password" autocomplete="current-password" />
            </label>
          </div>

          <label class="check-field security-check">
            <input v-model="connection.accept_new_host_key" type="checkbox" />
            <span>
              Confiar em <strong>host ainda desconhecido</strong> e gravar em <code>known_hosts</code>.
              Mudança de chave continua bloqueada.
            </span>
          </label>

          <div v-if="testResult" class="preflight">
            <div class="status-title">
              <span class="status-dot ok"></span>
              SSH validado — {{ testResult.fingerprint_sha256 }}
            </div>
            <div class="preflight-grid">
              <div><span>SO</span><strong>{{ testResult.server.os }} / {{ testResult.server.architecture }}</strong></div>
              <div><span>Docker</span><strong>{{ testResult.server.docker_available ? 'OK' : 'Ausente' }}</strong></div>
              <div><span>Compose v2</span><strong>{{ testResult.server.compose_available ? 'OK' : 'Ausente' }}</strong></div>
              <div><span>CloudPanel</span><strong>{{ testResult.server.cloudpanel_available ? 'Detectado' : 'Não detectado' }}</strong></div>
              <div><span>clpctl</span><strong>{{ testResult.server.clpctl_available ? 'OK' : 'Ausente' }}</strong></div>
              <div><span>Disco /opt</span><strong>{{ formatBytes(testResult.server.disk_available_bytes) }}</strong></div>
            </div>
          </div>
        </article>

        <article class="card">
          <div class="card-heading">
            <div>
              <span class="eyebrow">02</span>
              <h2>Deployment</h2>
            </div>
            <div class="environment-switch">
              <button :class="{ active: deploy.environment === 'develop' }" @click="deploy.environment = 'develop'">Develop</button>
              <button :class="{ active: deploy.environment === 'production' }" @click="deploy.environment = 'production'">Production</button>
            </div>
          </div>

          <div class="grid grid-2">
            <label class="field field-span-2">
              <span>Repositório</span>
              <input v-model.trim="deploy.repository" />
            </label>
            <label class="field">
              <span>Versão</span>
              <input v-model.trim="deploy.version" :placeholder="isProduction ? 'latest ou vX.Y.Z' : 'develop'" />
            </label>
            <label class="field">
              <span>Deployment</span>
              <select v-model="deploy.deployment">
                <option value="platform-production">platform-production</option>
                <option value="platform-develop">platform-develop</option>
                <option value="platform">platform</option>
                <option value="production">production</option>
                <option value="develop">develop</option>
                <option value="canonical">canonical</option>
                <option value="homologation">homologation</option>
                <option value="cloudpanel">cloudpanel</option>
                <option value="dockge">dockge</option>
                <option value="docs">docs</option>
                <option value="docs-develop">docs-develop</option>
              </select>
            </label>
            <label class="field field-span-2">
              <span>Diretório da stack</span>
              <input v-model.trim="deploy.directory" />
            </label>
            <label class="field">
              <span>Ação</span>
              <select v-model="deploy.action">
                <option value="plan">Plano — não grava</option>
                <option value="prepare">Preparar — grava configuração</option>
                <option value="apply">Aplicar — pull + up + health</option>
              </select>
            </label>
            <label class="field">
              <span>Timeout de readiness</span>
              <input v-model.number="deploy.wait_seconds" type="number" min="0" max="3600" />
            </label>
          </div>

          <div class="grid grid-2 nested-panel">
            <label class="field">
              <span>Domínio base Platform</span>
              <input v-model.trim="deploy.platform_domain" placeholder="Opcional; não altera atualização se vazio" />
            </label>
            <label class="field">
              <span>E-mail administrador</span>
              <input v-model.trim="deploy.platform_admin_email" type="email" />
            </label>
            <label class="field">
              <span>E-mail ACME</span>
              <input v-model.trim="deploy.acme_email" type="email" />
            </label>
            <label class="field">
              <span>Origem DNS / IP</span>
              <input v-model.trim="deploy.cloudflare_tenant_record_target" placeholder="IP público ou hostname DNS-only" />
            </label>
            <label class="field field-span-2">
              <span>Token Cloudflare</span>
              <input v-model="deploy.cloudflare_api_token" type="password" autocomplete="new-password" />
            </label>
          </div>

          <div class="grid grid-2">
            <label class="field">
              <span>.env inicial local</span>
              <div class="input-action">
                <input :value="envInputPath || ''" readonly placeholder="Opcional; só instalação nova" />
                <button class="ghost" type="button" @click="selectEnvFile">Selecionar</button>
              </div>
            </label>
            <div class="field actions-inline">
              <span>&nbsp;</span>
              <button v-if="envInputPath" class="ghost" type="button" @click="envInputPath = null">Remover .env selecionado</button>
            </div>
          </div>
        </article>

        <article class="card">
          <div class="card-heading">
            <div>
              <span class="eyebrow">03</span>
              <h2>Segurança e registries</h2>
            </div>
            <button class="ghost" type="button" @click="clearSecrets">Limpar segredos</button>
          </div>

          <div class="grid grid-2">
            <label class="field">
              <span>GitHub token — repositório privado</span>
              <input v-model="deploy.github_token" type="password" autocomplete="new-password" placeholder="Opcional" />
            </label>
            <label class="field">
              <span>Usuário GHCR</span>
              <input v-model.trim="deploy.registry_user" placeholder="wkarts" />
            </label>
            <label class="field">
              <span>Token GHCR read:packages</span>
              <input v-model="deploy.registry_token" type="password" autocomplete="new-password" placeholder="Opcional" />
            </label>
            <label class="check-field">
              <input v-model="deploy.accept_host_agent" type="checkbox" />
              <span>Autorizar CloudPanel Agent root-equivalent</span>
            </label>
            <label class="check-field">
              <input v-model="deploy.install_dockge" type="checkbox" />
              <span>Instalar Dockge separado</span>
            </label>
            <label v-if="deploy.install_dockge" class="check-field danger-check">
              <input v-model="deploy.accept_docker_socket" type="checkbox" />
              <span>Autorizar acesso administrativo ao Docker socket</span>
            </label>
          </div>
        </article>
      </section>

      <aside class="right-column">
        <article class="card sticky-card">
          <div class="card-heading compact">
            <div>
              <span class="eyebrow">STATUS</span>
              <h2>Implantação</h2>
            </div>
            <span class="environment-label" :class="deploy.environment">{{ deploy.environment }}</span>
          </div>

          <div class="progress-wrap">
            <div class="progress-meta"><span>Progresso</span><strong>{{ progress }}%</strong></div>
            <div class="progress"><div :style="{ width: `${progress}%` }"></div></div>
          </div>

          <div v-if="errorMessage" class="alert error">
            <strong>Operação bloqueada</strong>
            <span>{{ errorMessage }}</span>
          </div>

          <div class="agent-box">
            <span>Agentes embutidos</span>
            <code v-if="agentsEmbedded">amd64 ✓ / arm64 ✓</code>
            <code v-else-if="agentStatus">build incompleto</code>
            <code v-else>verificando…</code>
          </div>

          <div class="log-panel">
            <div v-if="logs.length === 0" class="empty-log">
              Os eventos do agente Rust aparecerão aqui durante o deploy.
            </div>
            <div v-for="(log, index) in logs" :key="`${index}-${log.step}`" class="log-row" :class="logClass(log.kind)">
              <span class="log-step">{{ log.step }}</span>
              <span>{{ log.message }}</span>
            </div>
          </div>

          <div class="deploy-actions">
            <button class="primary" :disabled="!canDeploy" @click="startDeploy">
              {{ deploying ? 'Executando…' : deploy.action === 'apply' ? 'IMPLANTAR' : deploy.action === 'prepare' ? 'PREPARAR' : 'VALIDAR PLANO' }}
            </button>
            <small>
              O VPS recebe somente um agente Linux Rust temporário. Python, Node.js, Go e Rust não são necessários no servidor.
            </small>
          </div>

          <details v-if="lastResult" class="result-details">
            <summary>Recibo da última operação</summary>
            <pre>{{ JSON.stringify(lastResult, null, 2) }}</pre>
          </details>
        </article>
      </aside>
    </main>
  </div>
</template>
