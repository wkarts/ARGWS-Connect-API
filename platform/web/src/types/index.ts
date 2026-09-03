export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}

export interface AuthUser {
  id: string
  name: string
  email: string
  role: string
  permissions: string[]
  companies: string[]
}

export interface AuthSecurity {
  required: boolean
  enabled: boolean
  verified: boolean
  mode: 'NONE' | 'SETUP' | 'VERIFY'
}

export interface AuthSession {
  tokens: TokenPair
  user: AuthUser
  tenant?: { id: string; slug: string; hostname: string; timezone: string }
  security?: AuthSecurity
}

export interface ApiResponse<T> {
  success: boolean
  data: T
}

export interface Paginated<T> {
  success: boolean
  data: T[]
  meta: { page: number; per_page: number; total: number; pages: number }
}

export interface TenantDomain {
  id: string
  hostname: string
  domain_type: string
  management_mode: string
  dns_provider: string
  status: string
  is_primary: boolean
  is_temporary: boolean
  redirect_to_primary?: boolean
  zone_name?: string | null
  zone_id?: string | null
  dns_record_type?: string
  dns_target?: string | null
  dns_proxied?: boolean
  nameservers?: string[]
  provider_metadata?: Record<string, unknown>
  dns_verified_at?: string | null
  ownership_verified_at?: string | null
  last_reconciled_at?: string | null
  dnssec_status?: string
  ssl_status: string
  ssl_issued_at?: string | null
  last_checked_at?: string | null
  last_error?: string | null
}

export interface Tenant {
  id: string
  name: string
  slug: string
  legal_document?: string
  status: string
  plan_code: string
  timezone: string
  features: Record<string, unknown>
  limits: Record<string, unknown>
  created_at: string
  domains: TenantDomain[]
}

export interface Company {
  id: string
  legal_name: string
  trade_name?: string
  tax_id: string
  email?: string
  phone?: string
  address: Record<string, unknown>
  branding: Record<string, unknown>
  settings: Record<string, unknown>
  is_active: boolean
  created_at: string
}

export interface Customer {
  id: string
  person_type: string
  name: string
  trade_name?: string
  tax_id?: string
  email?: string
  phone?: string
  whatsapp?: string
  address: Record<string, unknown>
  tags: string[]
  is_active: boolean
  created_at: string
}

export interface ServiceItem {
  id: string
  code: string
  name: string
  description?: string
  default_amount: string
  default_frequency: string
  is_active: boolean
}

export interface Contract {
  id: string
  company_id: string
  customer_id: string
  service_id: string
  code: string
  amount: string
  frequency: string
  billing_method: string
  due_day: number
  start_date: string
  end_date?: string
  next_generation_date: string
  status: string
  created_at: string
}

export interface Receivable {
  id: string
  company_id: string
  customer_id: string
  contract_id?: string
  document_number: string
  competence: string
  description: string
  issue_date: string
  due_date: string
  original_amount: string
  discount_amount: string
  interest_amount: string
  fine_amount: string
  paid_amount: string
  balance: string
  status: string
  source: string
  created_at: string
}

export interface Charge {
  id: string
  receivable_id: string
  charge_type: string
  provider: string
  external_id: string
  our_number?: string
  txid?: string
  digitable_line?: string
  barcode?: string
  pix_copy_paste?: string
  document_url?: string
  status: string
  registered_at?: string
}

export interface Payment {
  id: string
  receivable_id: string
  charge_id?: string
  provider: string
  external_id: string
  end_to_end_id?: string
  amount: string
  paid_at: string
  payment_method: string
  status: string
}

export interface PlatformPlan {
  id: string
  code: string
  name: string
  description?: string
  monthly_price: string
  annual_price: string
  features: Record<string, boolean>
  limits: Record<string, number | string | null>
  sort_order: number
  is_public: boolean
  is_active: boolean
  created_at: string
}

export interface PlatformUser {
  id: string
  name: string
  email: string
  role: string
  is_active: boolean
  last_login_at?: string
  locked_until?: string
  created_at: string
}

export interface PlatformSetting {
  id: string
  key: string
  category: string
  value: Record<string, unknown>
  description?: string
  is_secret: boolean
  updated_at: string
}

export interface ProvisioningJob {
  id: string
  tenant_id: string
  tenant_name?: string
  tenant_slug?: string
  operation: string
  status: string
  current_step: string
  progress: number
  attempts: number
  correlation_id: string
  events: Array<{ at: string; step: string; level: string; message: string }>
  started_at?: string
  finished_at?: string
  last_error?: string
  created_at: string
}

export interface BankAccount {
  id: string
  company_id: string
  bank_code: string
  bank_name: string
  branch: string
  branch_digit?: string
  account: string
  account_digit?: string
  account_type: string
  pix_key_type?: string
  pix_key?: string
  is_default: boolean
  is_active: boolean
}

export interface BankAgreement {
  id: string
  company_id: string
  bank_account_id: string
  name: string
  provider: string
  environment: string
  agreement_number?: string
  wallet?: string
  beneficiary_code?: string
  cnab_layout: string
  settings: Record<string, unknown>
  is_active: boolean
}

export interface PixAutomaticMandate {
  id: string
  company_id: string
  customer_id: string
  contract_id?: string
  bank_agreement_id: string
  provider: string
  external_id: string
  frequency: string
  start_date: string
  finish_date?: string
  fixed_amount?: string
  min_limit_value?: string
  description: string
  payment_creation_mode: string
  retry_policy: string
  status: string
  authorization_url?: string
  qr_copy_paste?: string
  qr_encoded_image?: string
  activated_at?: string
  cancelled_at?: string
  last_synced_at?: string
  last_error?: string
  created_at: string
}

export interface NotificationItem {
  id: string
  channel: string
  provider: string
  destination: string
  subject?: string
  body: string
  status: string
  scheduled_at: string
  sent_at?: string
  delivered_at?: string
  read_at?: string
  attempts: number
  last_error?: string
}

export interface Negotiation {
  id: string
  company_id: string
  customer_id: string
  original_amount: string
  negotiated_amount: string
  installment_count: number
  first_due_date: string
  status: string
  terms: Record<string, unknown>
  approved_at?: string
  cancelled_at?: string
  created_at: string
}

export interface PaymentLink {
  id: string
  receivable_id: string
  token_prefix: string
  public_url?: string
  expires_at?: string
  max_views?: number
  view_count: number
  is_active: boolean
  created_at: string
}

export interface TenantRole {
  id: string
  code: string
  name: string
  description?: string
  permissions: string[]
  is_system: boolean
  is_active: boolean
}
