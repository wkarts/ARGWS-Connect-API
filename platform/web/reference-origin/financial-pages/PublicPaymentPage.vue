<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Building2, CalendarDays, CheckCircle2, Copy, Download, FileUp,
  QrCode, ReceiptText, ShieldCheck,
} from 'lucide-vue-next'
import { useRoute } from 'vue-router'
import { api, apiError } from '../api/client'
import type { ApiResponse } from '../types'
import { dateBR, money } from '../utils/format'
import { statusLabel } from '../utils/labels'

interface PaymentData {
  tenant:{slug:string;hostname:string}
  company:{name:string;tax_id:string;branding:Record<string,unknown>}
  customer:{name:string;document:string}
  receivable:{id:string;document_number:string;description:string;competence:string;due_date:string;amount:string;status:string}
  charge?:{
    type:string;provider:string;status:string;digitable_line?:string;barcode?:string
    pix_copy_paste?:string;document_url?:string;pix_qr_url?:string;proof_upload_url?:string
  }
}

const route=useRoute()
const data=ref<PaymentData|null>(null)
const error=ref('')
const copied=ref('')
const proofMessage=ref('')
const proofBusy=ref(false)
const proofInput=ref<HTMLInputElement|null>(null)
const brandColor=computed(()=>String(data.value?.company.branding?.primary_color||'#0f766e'))

async function load(){
  error.value=''
  try{
    data.value=(await api.get<ApiResponse<PaymentData>>(`/public/v1/payment-links/${route.params.token}`)).data.data
    document.title=`Cobrança · ${data.value.company.name}`
  }catch(e){error.value=apiError(e)}
}
async function copy(value?:string,label='Código'){
  if(!value)return
  await navigator.clipboard.writeText(value)
  copied.value=`${label} copiado.`
  window.setTimeout(()=>copied.value='',2500)
}
function chooseProof(){proofInput.value?.click()}
async function uploadProof(event:Event){
  const input=event.target as HTMLInputElement
  const file=input.files?.[0]
  if(!file)return
  proofBusy.value=true;proofMessage.value='';error.value=''
  try{
    const form=new FormData();form.append('file',file)
    await api.post(`/public/v1/payment-links/${route.params.token}/proof`,form,{headers:{'Content-Type':'multipart/form-data'}})
    proofMessage.value='Comprovante recebido com segurança. A equipe financeira poderá conferi-lo na cobrança.'
  }catch(e){error.value=apiError(e)}finally{proofBusy.value=false;input.value=''}
}
onMounted(load)
</script>

<template>
  <main class="min-h-screen bg-slate-100 px-4 py-8 sm:py-14">
    <div class="mx-auto max-w-3xl">
      <section v-if="error&&!data" class="rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-xl">
        <ReceiptText :size="42" class="mx-auto text-rose-500"/>
        <h1 class="mt-4 text-xl font-bold">Cobrança indisponível</h1><p class="mt-2 text-slate-600">{{error}}</p>
      </section>
      <template v-else-if="data">
        <header class="mb-5 flex items-center gap-4 rounded-3xl bg-white p-5 shadow-soft">
          <div class="grid h-14 w-14 place-items-center rounded-2xl text-white" :style="{backgroundColor:brandColor}"><Building2 :size="28"/></div>
          <div class="min-w-0"><h1 class="truncate text-xl font-bold">{{data.company.name}}</h1><p class="text-sm text-slate-500">Portal seguro de cobrança</p></div>
          <ShieldCheck class="ml-auto text-emerald-600"/>
        </header>
        <section class="overflow-hidden rounded-3xl bg-white shadow-xl">
          <div class="p-6 text-white sm:p-8" :style="{backgroundColor:brandColor}">
            <p class="text-sm opacity-80">Valor atualizado</p><p class="mt-2 text-4xl font-black">{{money(data.receivable.amount)}}</p>
            <div class="mt-5 flex flex-wrap gap-3 text-sm"><span class="rounded-full bg-white/15 px-3 py-1">Documento {{data.receivable.document_number}}</span><span class="rounded-full bg-white/15 px-3 py-1">{{statusLabel(data.receivable.status)}}</span></div>
          </div>
          <div class="space-y-6 p-6 sm:p-8">
            <div v-if="error" class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{{error}}</div>
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="rounded-2xl bg-slate-50 p-4"><p class="text-xs uppercase text-slate-400">Pagador</p><p class="mt-2 font-bold">{{data.customer.name}}</p><p class="text-sm text-slate-500">{{data.customer.document}}</p></div>
              <div class="rounded-2xl bg-slate-50 p-4"><p class="text-xs uppercase text-slate-400">Vencimento</p><p class="mt-2 inline-flex items-center gap-2 font-bold"><CalendarDays :size="18"/>{{dateBR(data.receivable.due_date)}}</p><p class="text-sm text-slate-500">Competência {{data.receivable.competence}}</p></div>
            </div>
            <div><p class="text-xs uppercase text-slate-400">Descrição</p><p class="mt-2 font-semibold">{{data.receivable.description}}</p></div>

            <div v-if="data.charge?.pix_copy_paste" class="rounded-2xl border border-teal-200 bg-teal-50 p-5">
              <div class="flex items-center gap-3"><QrCode class="text-teal-700"/><div><p class="font-bold text-teal-950">Pague por PIX</p><p class="text-sm text-teal-700">Escaneie o QR Code ou use o código copia e cola.</p></div></div>
              <div class="mt-4 grid gap-4 md:grid-cols-[220px_1fr] md:items-center">
                <div v-if="data.charge.pix_qr_url" class="mx-auto rounded-2xl bg-white p-3 shadow-sm"><img :src="data.charge.pix_qr_url" alt="QR Code PIX" class="h-48 w-48"/></div>
                <div><textarea :value="data.charge.pix_copy_paste" readonly class="input min-h-28 font-mono text-xs"/><button class="btn-primary mt-3 w-full" @click="copy(data.charge?.pix_copy_paste,'PIX')"><Copy :size="18"/>Copiar código PIX</button></div>
              </div>
            </div>

            <div v-if="data.charge?.digitable_line" class="rounded-2xl border border-slate-200 p-5">
              <p class="font-bold">Boleto bancário</p><p class="mt-1 text-sm text-slate-500">Linha digitável</p>
              <div class="mt-3 flex gap-2"><input :value="data.charge.digitable_line" readonly class="input font-mono text-xs"/><button class="btn-secondary" @click="copy(data.charge?.digitable_line,'Linha digitável')"><Copy :size="17"/></button></div>
              <a v-if="data.charge.document_url" :href="data.charge.document_url" class="btn-secondary mt-3 w-full"><Download :size="18"/>Baixar boleto em PDF</a>
            </div>

            <div v-if="data.charge?.pix_copy_paste" class="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div class="flex items-start gap-3"><FileUp class="mt-0.5 text-slate-600"/><div class="flex-1"><p class="font-bold">Comprovante do PIX</p><p class="mt-1 text-sm text-slate-500">Para PIX estático, você pode anexar o comprovante para conferência financeira. O envio não baixa a cobrança automaticamente.</p></div></div>
              <input ref="proofInput" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" class="hidden" @change="uploadProof"/>
              <button class="btn-secondary mt-4 w-full" :disabled="proofBusy" @click="chooseProof"><FileUp :size="18"/>{{proofBusy?'Enviando comprovante…':'Anexar comprovante'}}</button>
              <p v-if="proofMessage" class="mt-3 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{{proofMessage}}</p>
            </div>

            <div v-if="copied" class="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700"><CheckCircle2 :size="18"/>{{copied}}</div>
          </div>
        </section>
        <p class="mt-5 text-center text-xs text-slate-400">Cobrança apresentada em ambiente seguro. Nunca informe senhas ou códigos de autenticação.</p>
      </template>
      <div v-else class="grid min-h-96 place-items-center"><div class="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-teal-700"/></div>
    </div>
  </main>
</template>
