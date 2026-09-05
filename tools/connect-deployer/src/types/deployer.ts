export type AuthMethod = 'key' | 'password' | 'agent';
export type Environment = 'develop' | 'production';
export type DeployAction = 'plan' | 'prepare' | 'apply';

export interface ConnectionInput {
  host: string;
  port: number;
  user: string;
  auth_method: AuthMethod;
  key_file?: string | null;
  key_passphrase?: string | null;
  password?: string | null;
  known_hosts_file?: string | null;
  accept_new_host_key: boolean;
  sudo: boolean;
  connect_timeout_seconds: number;
}

export interface DeployRequest {
  protocol_version: number;
  repository: string;
  environment: Environment;
  version: string;
  deployment: string;
  directory: string;
  action: DeployAction;
  platform_admin_email?: string | null;
  platform_domain?: string | null;
  acme_email?: string | null;
  cloudflare_api_token?: string | null;
  cloudflare_tenant_record_target?: string | null;
  github_token?: string | null;
  registry_user?: string | null;
  registry_token?: string | null;
  env_input?: string | null;
  accept_host_agent: boolean;
  install_dockge: boolean;
  accept_docker_socket: boolean;
  dockge_directory: string;
  wait_seconds: number;
}

export interface DesktopDeployRequest {
  connection: ConnectionInput;
  deploy: DeployRequest;
  env_input_path?: string | null;
}

export interface ServerPreflight {
  os: string;
  architecture: string;
  kernel: string;
  docker_available: boolean;
  docker_version?: string | null;
  compose_available: boolean;
  compose_version?: string | null;
  cloudpanel_available: boolean;
  clpctl_available: boolean;
  disk_available_bytes?: number | null;
  effective_user: string;
}

export interface ConnectionTestResult {
  fingerprint_sha256: string;
  host_key_type: string;
  known_host_status: string;
  server: ServerPreflight;
}

export interface AgentEvent {
  protocol_version: number;
  kind: 'info' | 'warning' | 'error' | 'result';
  step: string;
  message: string;
  progress?: number | null;
  data?: unknown;
}
