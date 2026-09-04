<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Cloud, Database, Eye, EyeOff, Image, KeyRound, Mail, MessageCircle, Plus, Save, Settings2 } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse, PlatformSetting } from '../types'
import PageHeader from '../components/PageHeader.vue'
import ModalDialog from '../components/ModalDialog.vue'
import InlineAlert from '../components/InlineAlert.vue'
import StatusBadge from '../components/StatusBadge.vue'
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect.vue'
import ObjectFieldsEditor from '../components/ObjectFieldsEditor.vue'

interface PlatformIntegration {
  id: string
  provider: string
  is_enabled: boolean
  public_config: Record<string, unknown>
  has_secrets: boolean
  health_status?: string
  health_checked_at?: string
  last_error?: string
}
interface IntegrationPreset {
  provider:string
  label:string
  description:string
  icon:'engine'|'email'|'storage'
  publicFields:Array<{key:string;label:string;type?:string;placeholder?:string;options?:SearchSelectOption[]}>
  secretFields:Array<{key:string;label:string;placeholder?:string}>
}

const integrationPresets:IntegrationPreset[]=[
  {provider:'CONNECT_ENGINE',label:'Connect|API Engine',description:'Motor canônico Node/TypeScript responsável por canais, mensagens, templates, Actions, Recipes e Micro Apps.',icon:'engine',publicFields:[{key:'base_url',label:'URL interna do Engine',placeholder:'http://connect-engine:8080'}],secretFields:[{key:'api_key',label:'API key interna do Engine',placeholder:'••••••••'}]},
  {provider:'SMTP',label:'E-mail',description:'Servidor de e-mail usado pela plataforma para notificações administrativas e operacionais.',icon:'email',publicFields:[{key:'host',label:'Servidor SMTP',placeholder:'smtp.exemplo.com.br'},{key:'port',label:'Porta',type:'number',placeholder:'587'},{key:'security',label:'Segurança',options:[{value:'starttls',label:'STARTTLS'},{value:'ssl',label:'SSL/TLS'},{value:'none',label:'Sem criptografia'}]},{key:'from_name',label:'Nome do remetente',placeholder:'Connect|API'},{key:'from_email',label:'E-mail remetente',placeholder:'connect@exemplo.com.br'}],secretFields:[{key:'username',label:'Usuário SMTP',placeholder:'••••••••'},{key:'password',label:'Senha SMTP',placeholder:'••••••••'}]},
  {provider:'S3',label:'Object Storage',description:'Armazenamento S3/MinIO da plataforma para arquivos, mídia, backups e artefatos.',icon:'storage',publicFields:[{key:'endpoint',label:'Endpoint S3',placeholder:'http://connect-minio:9000'},{key:'region',label:'Região',placeholder:'us-east-1'},{key:'bucket_prefix',label:'Prefixo de buckets',placeholder:'connect-api-tenant'}],secretFields:[{key:'access_key',label:'Access key',placeholder:'••••••••'},{key:'secret_key',label:'Secret key',placeholder:'••••••••'}]},
]

const settings = ref<PlatformSetting[]>([])
const integrations = ref<PlatformIntegration[]>([])
const error = ref('')
const success = ref('')
const settingModal = ref(false)
const integrationModal = ref(false)
const landingSaving = ref(false)
const settingForm = reactive({ key: '', category: 'GENERAL', description: '', is_secret: false, value: {} as Record<string, unknown> })
const integrationForm = reactive({ provider: 'CONNECT_ENGINE', is_enabled: true, public_config: {} as Record<string, unknown>, secrets: {} as Record<string, unknown> })
const landingForm=reactive({
  enabled:true,show_brand:true,brand_name:'Connect|API Platform',
  headline:'Conecte canais, eventos e sistemas em uma única plataforma.',
  subheadline:'Centralize integrações, webhooks, automações e comunicação em um ambiente multitenant.',
  cta_label:'Falar sobre a plataforma',cta_url:'',show_plans:true,show_gallery:false,gallery_text:'',
})
const categories = computed(() => [...new Set(settings.value.map(item => item.category))].sort())
const providerOptions=computed<SearchSelectOption[]>(()=>integrationPresets.map(item=>({value:item.provider,label:item.label,description:item.description})))
const currentPreset=computed(()=>integrationPresets.find(item=>item.provider===integrationForm.provider)||integrationPresets[0])
const categoryOptions=computed<SearchSelectOption[]>(()=>Array.from(new Set(['GENERAL','SECURITY','INTEGRATIONS','COMMUNICATION','PROVISIONING','BACKUP',...categories.value])).map(value=>({value,label:({GENERAL:'Geral',SECURITY:'Segurança',INTEGRATIONS:'Integrações',COMMUNICATION:'Comunicação',PROVISIONING:'Provisionamento',BACKUP:'Backup'} as Record<string,string>)[value]||value})))
const integrationLabel=(provider:string)=>integrationPresets.find(item=>item.provider===provider)?.label||provider
const fieldPreview=(value:Record<string,unknown>)=>Object.entries(value||{}).slice(0,4).map(([key,item])=>`${key}: ${typeof item==='boolean'?(item?'Sim':'Não'):String(item)}`).join(' · ')

function applyLandingSetting(){
  const item=settings.value.find(entry=>entry.key.toUpperCase()==='PUBLIC.LANDING')
  const value=(item?.value||{}) as Record<string,unknown>
  const gallery=Array.isArray(value.gallery)?value.gallery:[]
  Object.assign(landingForm,{
    enabled:value.enabled!==false,
    show_brand:value.show_brand!==false,
    brand_name:String(value.brand_name||'Connect|API Platform'),
    headline:String(value.headline||'Conecte canais, eventos e sistemas em uma única plataforma.'),
    subheadline:String(value.subheadline||'Centralize integrações, webhooks, automações e comunicação em um ambiente multitenant.'),
    cta_label:String(value.cta_label||'Falar sobre a plataforma'),
    cta_url:String(value.cta_url||''),
    show_plans:value.show_plans!==false,
    show_gallery:Boolean(value.show_gallery),
    gallery_text:gallery.filter(entry=>entry&&typeof entry==='object').map(entry=>{
      const row=entry as Record<string,unknown>;return `${String(row.url||'')}|${String(row.caption||'')}`
    }).filter(Boolean).join('\n'),
  })
}

async function load() {
  error.value = ''
  try {
    const [settingResponse, integrationResponse] = await Promise.all([
      api.get<ApiResponse<PlatformSetting[]>>('/control/v1/settings'),
      api.get<ApiResponse<PlatformIntegration[]>>('/control/v1/platform-integrations')
    ])
    settings.value = settingResponse.data.data
    integrations.value = integrationResponse.data.data
    applyLandingSetting()
  } catch (exception) { error.value = apiError(exception) }
}

async function saveLanding(){
  landingSaving.value=true;error.value='';success.value=''
  try{
    const gallery=landingForm.gallery_text.split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{
      const [url,...caption]=line.split('|');return{url:url.trim(),caption:caption.join('|').trim()}
    }).filter(item=>item.url.startsWith('https://')||item.url.startsWith('/')).slice(0,8)
    await api.put('/control/v1/settings/PUBLIC.LANDING',{
      category:'GENERAL',description:'Conteúdo e privacidade da landing page pública.',is_secret:false,
      value:{enabled:landingForm.enabled,show_brand:landingForm.show_brand,brand_name:landingForm.brand_name.trim(),headline:landingForm.headline.trim(),subheadline:landingForm.subheadline.trim(),cta_label:landingForm.cta_label.trim(),cta_url:landingForm.cta_url.trim(),show_plans:landingForm.show_plans,show_gallery:landingForm.show_gallery,gallery}
    })
    success.value='Landing page atualizada. O conteúdo público foi limitado às informações comerciais autorizadas.'
    await load()
  }catch(exception){error.value=apiError(exception)}finally{landingSaving.value=false}
}

function openSetting(item?: PlatformSetting) {
  Object.assign(settingForm, {
    key: item?.key || '', category: item?.category || 'GENERAL', description: item?.description || '',
    is_secret: item?.is_secret || false, value: { ...(item?.value || {}) }
  })
  settingModal.value = true
}
async function saveSetting() {
  error.value = ''
  try {
    await api.put(`/control/v1/settings/${settingForm.key}`, {
      category: settingForm.category, description: settingForm.description || null,
      is_secret: settingForm.is_secret, value: settingForm.value
    })
    settingModal.value = false; success.value = 'Configuração salva.'; await load()
  } catch (exception) { error.value = apiError(exception) }
}

function openIntegration(item?: PlatformIntegration) {
  const provider=item?.provider||'CONNECT_ENGINE'
  Object.assign(integrationForm, {
    provider, is_enabled: item?.is_enabled ?? true,
    public_config: { ...(item?.public_config || {}) }, secrets: {}
  })
  integrationModal.value = true
}
function changeIntegrationType(){integrationForm.public_config={};integrationForm.secrets={}}
async function saveIntegration() {
  error.value = ''
  try {
    await api.put(`/control/v1/platform-integrations/${integrationForm.provider}`, {
      is_enabled: integrationForm.is_enabled, public_config: integrationForm.public_config,
      secrets: Object.fromEntries(Object.entries(integrationForm.secrets).filter(([,value])=>String(value||'').trim()!==''))
    })
    integrationModal.value = false; success.value = `${currentPreset.value.label} atualizado.`; await load()
  } catch (exception) { error.value = apiError(exception) }
}
onMounted(load)
</script>

<template>
  <PageHeader title="Configurações da plataforma" subtitle="Parâmetros globais e serviços compartilhados administrados pelo Control Plane.">
    <button class="btn-secondary" @click="openIntegration()"><Cloud :size="18" /> Nova integração</button>
    <button class="btn-primary" @click="openSetting()"><Plus :size="18" /> Nova configuração</button>
  </PageHeader>
  <InlineAlert :message="error" @dismiss="error=''" />
  <InlineAlert :message="success" type="success" @dismiss="success=''" />

  <section class="card mb-6 border-blue-100">
    <div class="flex flex-wrap items-start justify-between gap-4"><div><div class="flex items-center gap-2"><component :is="landingForm.enabled?Eye:EyeOff" :size="20" class="text-blue-700"/><h2 class="text-lg font-bold">Landing page pública</h2></div><p class="mt-1 max-w-3xl text-sm text-slate-500">Controle o que pode ser mostrado publicamente. URLs administrativas, infraestrutura, providers, repositórios e detalhes técnicos não são publicados pela landing.</p></div><StatusBadge :status="landingForm.enabled?'ACTIVE':'DISABLED'"/></div>
    <form class="mt-5 space-y-5" @submit.prevent="saveLanding">
      <div class="grid gap-4 lg:grid-cols-2"><label class="flex items-start gap-3 rounded-xl border border-slate-200 p-4"><input v-model="landingForm.enabled" type="checkbox" class="mt-1"/><span><strong class="block text-sm">Landing habilitada</strong><span class="text-xs text-slate-500">Desative para não apresentar conteúdo comercial público.</span></span></label><label class="flex items-start gap-3 rounded-xl border border-slate-200 p-4"><input v-model="landingForm.show_brand" type="checkbox" class="mt-1"/><span><strong class="block text-sm">Exibir marca</strong><span class="text-xs text-slate-500">Permite ocultar a marca sem alterar a aplicação autenticada.</span></span></label></div>
      <div class="grid gap-4 lg:grid-cols-2"><div><label class="label">Nome público</label><input v-model="landingForm.brand_name" class="input" maxlength="120"/></div><div><label class="label">Chamada do botão</label><input v-model="landingForm.cta_label" class="input" maxlength="80"/></div><div class="lg:col-span-2"><label class="label">Título principal</label><input v-model="landingForm.headline" class="input" maxlength="220"/></div><div class="lg:col-span-2"><label class="label">Texto de apresentação</label><textarea v-model="landingForm.subheadline" class="input min-h-24" maxlength="420"/></div><div class="lg:col-span-2"><label class="label">Destino comercial do botão <span class="font-normal text-slate-400">(opcional)</span></label><input v-model="landingForm.cta_url" class="input" placeholder="https://... ou deixe vazio para não exibir botão"/><p class="mt-1 text-xs text-slate-500">Não use URL do Control Plane ou da demonstração.</p></div></div>
      <div class="grid gap-4 lg:grid-cols-2"><label class="flex items-start gap-3 rounded-xl border border-slate-200 p-4"><input v-model="landingForm.show_plans" type="checkbox" class="mt-1"/><span><strong class="block text-sm">Exibir planos públicos</strong><span class="text-xs text-slate-500">Os valores e descrições vêm dos planos ativos marcados como públicos no Control Plane; features técnicas não são expostas.</span></span></label><label class="flex items-start gap-3 rounded-xl border border-slate-200 p-4"><input v-model="landingForm.show_gallery" type="checkbox" class="mt-1"/><span><strong class="block text-sm">Exibir galeria opcional</strong><span class="text-xs text-slate-500">Mostra apenas imagens escolhidas, sem liberar acesso à demo.</span></span></label></div>
      <div v-if="landingForm.show_gallery" class="rounded-xl border border-slate-200 bg-slate-50 p-4"><div class="flex items-center gap-2"><Image :size="18" class="text-slate-600"/><label class="font-semibold">Imagens da galeria</label></div><textarea v-model="landingForm.gallery_text" class="input mt-3 min-h-28 font-mono text-xs" placeholder="https://cdn.exemplo.com/tela-1.webp|Canais e instâncias\nhttps://cdn.exemplo.com/tela-2.webp|Eventos e automações"/><p class="mt-2 text-xs text-slate-500">Uma imagem por linha no formato URL|Legenda. Máximo de 8 imagens.</p></div>
      <div class="flex justify-end"><button class="btn-primary" :disabled="landingSaving"><Save :size="18"/>{{landingSaving?'Salvando…':'Salvar landing page'}}</button></div>
    </form>
  </section>

  <section class="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
    <div class="space-y-5">
      <div v-for="category in categories" :key="category" class="card !p-0 overflow-hidden">
        <div class="flex items-center gap-3 border-b border-slate-200 px-5 py-4"><Settings2 :size="20" class="text-blue-700" /><h2 class="font-semibold">{{ categoryOptions.find(option=>option.value===category)?.label||category }}</h2></div>
        <div class="divide-y divide-slate-100">
          <button v-for="item in settings.filter(value => value.category === category)" :key="item.id" class="flex w-full items-start gap-4 px-5 py-4 text-left hover:bg-slate-50" @click="openSetting(item)">
            <div class="mt-0.5 rounded-xl bg-slate-100 p-2 text-slate-600"><KeyRound :size="17" /></div>
            <div class="min-w-0 flex-1"><p class="font-semibold text-slate-900">{{ item.key }}</p><p class="mt-1 text-sm text-slate-500">{{ item.description || 'Sem descrição.' }}</p><p v-if="!item.is_secret" class="mt-2 truncate text-xs text-slate-400">{{fieldPreview(item.value) || 'Sem parâmetros definidos'}}</p><p v-else class="mt-2 text-xs text-slate-400">Valor protegido</p></div>
            <StatusBadge :status="item.is_secret ? 'SECRET' : 'PUBLIC'" />
          </button>
        </div>
      </div>
      <div v-if="!settings.length" class="card text-center text-sm text-slate-400">Nenhuma configuração persistida.</div>
    </div>

    <div class="space-y-4">
      <h2 class="text-lg font-semibold">Serviços globais</h2>
      <article v-for="item in integrations" :key="item.id" class="card">
        <div class="flex items-center gap-3"><div class="rounded-xl p-2.5" :class="item.provider==='CONNECT_ENGINE'?'bg-emerald-50 text-emerald-700':item.provider==='SMTP'?'bg-blue-50 text-blue-700':'bg-violet-50 text-violet-700'"><MessageCircle v-if="item.provider==='CONNECT_ENGINE'" :size="19"/><Mail v-else-if="item.provider==='SMTP'" :size="19"/><Database v-else :size="19"/></div><div class="min-w-0 flex-1"><p class="font-semibold">{{integrationLabel(item.provider)}}</p><p class="text-xs text-slate-400">Credenciais {{ item.has_secrets ? 'configuradas' : 'ausentes' }}</p></div><StatusBadge :status="item.is_enabled ? item.health_status || 'ACTIVE' : 'DISABLED'" /></div>
        <p class="mt-3 truncate text-xs text-slate-400">{{fieldPreview(item.public_config)||'Sem parâmetros públicos'}}</p>
        <p v-if="item.last_error" class="mt-3 line-clamp-2 text-xs text-rose-600">{{ item.last_error }}</p>
        <button class="btn-secondary mt-4 w-full" @click="openIntegration(item)"><Save :size="16" /> Editar</button>
      </article>
      <div v-if="!integrations.length" class="card text-center text-sm text-slate-400">Nenhuma integração global configurada.</div>
    </div>
  </section>

  <ModalDialog :open="settingModal" title="Configuração da plataforma" size="lg" @close="settingModal=false">
    <form class="space-y-5" @submit.prevent="saveSetting">
      <div class="grid gap-4 md:grid-cols-2"><div><label class="label">Chave</label><input v-model="settingForm.key" class="input" required /></div><div><label class="label">Categoria</label><SearchSelect v-model="settingForm.category" :options="categoryOptions" search-placeholder="Pesquisar categoria…"/></div></div>
      <div><label class="label">Descrição</label><textarea v-model="settingForm.description" class="input min-h-20" /></div>
      <ObjectFieldsEditor v-model="settingForm.value" label="Parâmetros" key-label="Parâmetro" value-label="Valor" />
      <label class="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"><input v-model="settingForm.is_secret" type="checkbox" class="mt-1"/><span><strong class="block">Proteger esta configuração</strong><span class="text-xs text-slate-500">Use quando o valor contiver dados que não devem ser exibidos novamente.</span></span></label>
      <div class="flex justify-end gap-2"><button type="button" class="btn-secondary" @click="settingModal=false">Cancelar</button><button class="btn-primary"><Save :size="18" /> Salvar</button></div>
    </form>
  </ModalDialog>

  <ModalDialog :open="integrationModal" title="Serviço global" size="lg" @close="integrationModal=false">
    <form class="space-y-5" @submit.prevent="saveIntegration">
      <div><label class="label">Serviço</label><SearchSelect v-model="integrationForm.provider" :options="providerOptions" search-placeholder="Pesquisar serviço…" @update:model-value="changeIntegrationType"/><p class="mt-2 text-sm leading-6 text-slate-500">{{currentPreset.description}}</p></div>
      <div class="grid gap-4 md:grid-cols-2"><div v-for="field in currentPreset.publicFields" :key="field.key"><label class="label">{{field.label}}</label><SearchSelect v-if="field.options" v-model="integrationForm.public_config[field.key] as string" :options="field.options"/><input v-else v-model="integrationForm.public_config[field.key]" :type="field.type||'text'" :placeholder="field.placeholder" class="input"/></div></div>
      <div v-if="currentPreset.secretFields.length" class="rounded-xl border border-amber-200 bg-amber-50 p-4"><p class="mb-3 text-sm font-semibold text-amber-900">Credenciais protegidas</p><div class="grid gap-4 md:grid-cols-2"><div v-for="field in currentPreset.secretFields" :key="field.key"><label class="label">{{field.label}}</label><input v-model="integrationForm.secrets[field.key]" type="password" :placeholder="field.placeholder" class="input" autocomplete="new-password"/></div></div><p class="mt-3 text-xs text-amber-800">Campos vazios preservam as credenciais existentes.</p></div>
      <details class="rounded-xl border border-slate-200 p-4"><summary class="cursor-pointer text-sm font-semibold text-slate-600">Parâmetros adicionais <span class="font-normal text-slate-400">(avançado)</span></summary><div class="mt-4"><ObjectFieldsEditor v-model="integrationForm.public_config" label="Campos adicionais e atuais"/></div></details>
      <label class="flex items-center gap-2 text-sm"><input v-model="integrationForm.is_enabled" type="checkbox" /> Serviço habilitado</label>
      <div class="flex justify-end gap-2"><button type="button" class="btn-secondary" @click="integrationModal=false">Cancelar</button><button class="btn-primary"><Save :size="18" /> Salvar</button></div>
    </form>
  </ModalDialog>
</template>
