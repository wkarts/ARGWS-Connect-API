<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  ArrowDown, ArrowUp, CheckCircle2, Code2, Copy, ExternalLink, Eye,
  GripVertical, History, Laptop, LayoutTemplate, Monitor, Palette, Plus,
  Redo2, RotateCcw, Save, Send, Smartphone, Tablet, Trash2, Undo2,
} from 'lucide-vue-next'
import { api, apiError } from '../../api/client'
import type { ApiResponse, PlatformPlan } from '../../types'
import { appConfirm, appPrompt } from '../../composables/useAppDialog'
import InlineAlert from '../InlineAlert.vue'
import {
  blockLibrary, cloneDocument, makeBlock, renderPreview,
  type LandingBlock, type LandingBlockType, type LandingDocument, type LandingPayload,
} from '../../landing/builder'

const props=withDefaults(defineProps<{apiBase:string;publicUrl:string;plansEndpoint?:string}>(),{plansEndpoint:'/control/v1/plans'})

const payload=ref<LandingPayload|null>(null)
const documentData=ref<LandingDocument>({schema_version:1,meta:{},theme:{},blocks:[]})
const customCss=ref('')
const plans=ref<Array<Record<string,unknown>>>([])
const selectedId=ref('')
const device=ref<'desktop'|'tablet'|'mobile'>('desktop')
const leftTab=ref<'blocks'|'tree'|'history'>('blocks')
const rightTab=ref<'content'|'style'|'page'|'css'>('content')
const loading=ref(false)
const saving=ref(false)
const error=ref('')
const success=ref('')
const dirty=ref(false)
const draggingBlockId=ref('')
const historyStack=ref<string[]>([])
const futureStack=ref<string[]>([])

const selectedBlock=computed(()=>documentData.value.blocks.find(block=>block.id===selectedId.value)||null)
const previewHtml=computed(()=>renderPreview(documentData.value,customCss.value,plans.value))
const previewWidth=computed(()=>device.value==='mobile'?'390px':device.value==='tablet'?'820px':'100%')
const publishedState=computed(()=>payload.value?.published_revision?`Versão publicada ${payload.value.published_revision}`:'Ainda não publicada')

const contentFields=computed(()=>{
  const type=selectedBlock.value?.type
  const map:Record<string,Array<{key:string;label:string;kind?:'text'|'textarea'|'url';placeholder?:string}>>={
    hero:[{key:'eyebrow',label:'Sobretítulo'},{key:'title',label:'Título',kind:'textarea'},{key:'text',label:'Texto',kind:'textarea'},{key:'button_label',label:'Botão principal'},{key:'button_url',label:'Destino do botão',kind:'url'},{key:'secondary_label',label:'Botão secundário'},{key:'secondary_url',label:'Destino secundário',kind:'url'}],
    text:[{key:'title',label:'Título'},{key:'text',label:'Texto',kind:'textarea'}],
    features:[{key:'title',label:'Título'},{key:'text',label:'Apresentação',kind:'textarea'}],
    plans:[{key:'title',label:'Título'},{key:'text',label:'Apresentação',kind:'textarea'}],
    image:[{key:'url',label:'URL da imagem',kind:'url'},{key:'alt',label:'Texto alternativo'},{key:'caption',label:'Legenda'},{key:'link_url',label:'Link opcional',kind:'url'}],
    gallery:[{key:'title',label:'Título'}],
    cta:[{key:'title',label:'Título'},{key:'text',label:'Texto',kind:'textarea'},{key:'button_label',label:'Texto do botão'},{key:'button_url',label:'Destino do botão',kind:'url'}],
    spacer:[{key:'height',label:'Altura'}],
    divider:[],html:[],
  }
  return type?map[type]||[]:[]
})

function eventValue(event:Event):string{return (event.target as HTMLInputElement|HTMLTextAreaElement).value}
function snapshot():string{return JSON.stringify({document:documentData.value,css:customCss.value})}
function remember(){const current=snapshot();if(historyStack.value.at(-1)!==current){historyStack.value.push(current);if(historyStack.value.length>80)historyStack.value.shift()}futureStack.value=[]}
function restoreSnapshot(raw:string){const parsed=JSON.parse(raw) as {document:LandingDocument;css:string};documentData.value=cloneDocument(parsed.document);customCss.value=parsed.css;selectedId.value=documentData.value.blocks[0]?.id||'';dirty.value=true}
function undo(){if(!historyStack.value.length)return;futureStack.value.push(snapshot());restoreSnapshot(historyStack.value.pop()!)}
function redo(){if(!futureStack.value.length)return;historyStack.value.push(snapshot());restoreSnapshot(futureStack.value.pop()!)}
function markDirty(){dirty.value=true}
function setProp(key:string,value:unknown){if(!selectedBlock.value)return;selectedBlock.value.props[key]=value;markDirty()}
function setStyle(key:string,value:string){if(!selectedBlock.value)return;selectedBlock.value.style[key]=value;markDirty()}
function setMeta(key:string,value:unknown){documentData.value.meta[key]=value;markDirty()}
function setTheme(key:string,value:string){documentData.value.theme[key]=value;markDirty()}
function itemsText(block:LandingBlock):string{
  const items=Array.isArray(block.props.items)?block.props.items:[]
  if(block.type==='gallery')return items.map(item=>typeof item==='object'?`${String((item as Record<string,unknown>).url||'')}|${String((item as Record<string,unknown>).caption||'')}`:String(item)).join('\n')
  return items.map(item=>typeof item==='object'?`${String((item as Record<string,unknown>).title||'')}|${String((item as Record<string,unknown>).text||'')}`:String(item)).join('\n')
}
function setItemsText(value:string){if(!selectedBlock.value)return;const lines=value.split('\n').map(line=>line.trim()).filter(Boolean).slice(0,40);selectedBlock.value.props.items=selectedBlock.value.type==='gallery'?lines.map(line=>{const [url,...caption]=line.split('|');return{url:url.trim(),caption:caption.join('|').trim()}}):lines.map(line=>{const [title,...text]=line.split('|');return text.length?{title:title.trim(),text:text.join('|').trim()}:title.trim()});markDirty()}
function addBlock(type:LandingBlockType,index=documentData.value.blocks.length){remember();const block=makeBlock(type);documentData.value.blocks.splice(index,0,block);selectedId.value=block.id;rightTab.value='content';leftTab.value='tree';markDirty()}
function duplicateBlock(block:LandingBlock){remember();const copy=cloneDocument(block);copy.id=`${block.type}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;copy.name=`${block.name} (cópia)`;const index=documentData.value.blocks.findIndex(item=>item.id===block.id);documentData.value.blocks.splice(index+1,0,copy);selectedId.value=copy.id;markDirty()}
async function removeBlock(block:LandingBlock){const ok=await appConfirm({title:'Remover bloco',message:`Remover “${block.name}” da landing page? A alteração ficará apenas no rascunho até publicar.`,confirmLabel:'Remover',cancelLabel:'Cancelar',tone:'danger'});if(!ok)return;remember();documentData.value.blocks=documentData.value.blocks.filter(item=>item.id!==block.id);selectedId.value=documentData.value.blocks[0]?.id||'';markDirty()}
function moveBlock(block:LandingBlock,direction:-1|1){const index=documentData.value.blocks.findIndex(item=>item.id===block.id),target=index+direction;if(index<0||target<0||target>=documentData.value.blocks.length)return;remember();const [item]=documentData.value.blocks.splice(index,1);documentData.value.blocks.splice(target,0,item);markDirty()}
function dragLibrary(event:DragEvent,type:LandingBlockType){event.dataTransfer?.setData('application/x-landing-library',type);if(event.dataTransfer)event.dataTransfer.effectAllowed='copy'}
function dragBlock(event:DragEvent,id:string){draggingBlockId.value=id;event.dataTransfer?.setData('application/x-landing-block',id);if(event.dataTransfer)event.dataTransfer.effectAllowed='move'}
function dropAt(event:DragEvent,index:number){event.preventDefault();const library=event.dataTransfer?.getData('application/x-landing-library') as LandingBlockType;if(library){addBlock(library,index);return}const id=event.dataTransfer?.getData('application/x-landing-block')||draggingBlockId.value;if(!id)return;const from=documentData.value.blocks.findIndex(item=>item.id===id);if(from<0)return;remember();const [item]=documentData.value.blocks.splice(from,1);const adjusted=from<index?index-1:index;documentData.value.blocks.splice(Math.max(0,adjusted),0,item);draggingBlockId.value='';selectedId.value=id;markDirty()}

async function load(){loading.value=true;error.value='';try{const [landingResponse,planResponse]=await Promise.all([api.get<ApiResponse<LandingPayload>>(props.apiBase),api.get<ApiResponse<PlatformPlan[]>>(props.plansEndpoint).catch(()=>null)]);payload.value=landingResponse.data.data;documentData.value=cloneDocument(payload.value.draft_document);customCss.value=payload.value.draft_css||'';selectedId.value=documentData.value.blocks[0]?.id||'';plans.value=(planResponse?.data.data||[]).filter(item=>item.is_active&&item.is_public).map(item=>({name:item.name,description:item.description,monthly_price:item.monthly_price,annual_price:item.annual_price}));dirty.value=false;historyStack.value=[];futureStack.value=[]}catch(exception){error.value=apiError(exception)}finally{loading.value=false}}
async function saveDraft(){saving.value=true;error.value='';success.value='';try{const response=await api.put<ApiResponse<LandingPayload>>(`${props.apiBase}/draft`,{document:documentData.value,custom_css:customCss.value,enabled:payload.value?.enabled,name:payload.value?.name});payload.value=response.data.data;dirty.value=false;success.value='Rascunho salvo. A página pública não muda até você publicar.'}catch(exception){error.value=apiError(exception)}finally{saving.value=false}}
async function checkpoint(){const note=await appPrompt({title:'Criar checkpoint',message:'Salve uma versão identificável do rascunho atual para poder restaurá-la depois.',inputLabel:'Descrição da versão',placeholder:'Ex.: ajuste do hero e planos',initialValue:'Checkpoint manual',confirmLabel:'Criar versão',cancelLabel:'Cancelar'});if(note===null)return;await saveDraft();try{payload.value=(await api.post<ApiResponse<LandingPayload>>(`${props.apiBase}/checkpoint`,{note})).data.data;success.value=`Checkpoint ${payload.value.current_revision} criado.`}catch(exception){error.value=apiError(exception)}}
async function publish(){const ok=await appConfirm({title:'Publicar landing page',message:'Publicar o rascunho atual em connect-api.example.com? A versão atualmente publicada continuará registrada no histórico.',confirmLabel:'Publicar agora',cancelLabel:'Cancelar',tone:'warning'});if(!ok)return;await saveDraft();saving.value=true;try{payload.value=(await api.post<ApiResponse<LandingPayload>>(`${props.apiBase}/publish`,{note:'Publicação pelo editor visual'})).data.data;dirty.value=false;success.value=`Landing publicada na versão ${payload.value.published_revision}.`}catch(exception){error.value=apiError(exception)}finally{saving.value=false}}
async function setEnabled(enabled:boolean){if(!payload.value)return;try{payload.value=(await api.patch<ApiResponse<LandingPayload>>(`${props.apiBase}/enabled`,{enabled})).data.data;success.value=enabled?'Landing pública habilitada.':'Landing pública desabilitada.'}catch(exception){error.value=apiError(exception)}}
async function restoreRevision(revision:number){const ok=await appConfirm({title:'Restaurar versão',message:`Carregar a versão ${revision} no rascunho atual? A versão publicada não muda até você publicar novamente.`,confirmLabel:'Restaurar no rascunho',cancelLabel:'Cancelar',tone:'warning'});if(!ok)return;try{payload.value=(await api.post<ApiResponse<LandingPayload>>(`${props.apiBase}/restore/${revision}`)).data.data;documentData.value=cloneDocument(payload.value.draft_document);customCss.value=payload.value.draft_css;selectedId.value=documentData.value.blocks[0]?.id||'';dirty.value=true;success.value=`Versão ${revision} restaurada no rascunho.`}catch(exception){error.value=apiError(exception)}}
function openPublic(){window.open(props.publicUrl,'_blank','noopener,noreferrer')}
onMounted(load)
</script>

<template>
  <div class="space-y-4">
    <InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>
    <header class="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-soft">
      <div class="mr-auto min-w-0"><div class="flex flex-wrap items-center gap-2"><h1 class="truncate text-lg font-bold">Editor visual da landing page</h1><span class="badge" :class="payload?.enabled?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-500'">{{payload?.enabled?'Publicada habilitada':'Página desabilitada'}}</span><span v-if="dirty" class="badge bg-amber-50 text-amber-700">Alterações não salvas</span></div><p class="mt-1 text-xs text-slate-500">{{publishedState}} · Editor reutilizável para futuras landing pages dos tenants.</p></div>
      <button class="btn-secondary !px-3" :disabled="!historyStack.length" @click="undo"><Undo2 :size="16"/></button><button class="btn-secondary !px-3" :disabled="!futureStack.length" @click="redo"><Redo2 :size="16"/></button>
      <button class="btn-secondary" @click="openPublic"><ExternalLink :size="16"/>Abrir pública</button>
      <button class="btn-secondary" :disabled="saving" @click="checkpoint"><History :size="16"/>Checkpoint</button>
      <button class="btn-secondary" :disabled="saving||!dirty" @click="saveDraft"><Save :size="16"/>Salvar rascunho</button>
      <button class="btn-primary" :disabled="saving" @click="publish"><Send :size="16"/>Publicar</button>
    </header>

    <div class="grid min-h-[760px] gap-3 xl:grid-cols-[270px_minmax(0,1fr)_330px]">
      <aside class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
        <div class="grid grid-cols-3 border-b border-slate-200 text-xs font-semibold"><button class="p-3" :class="leftTab==='blocks'?'bg-slate-950 text-white':''" @click="leftTab='blocks'">Blocos</button><button class="p-3" :class="leftTab==='tree'?'bg-slate-950 text-white':''" @click="leftTab='tree'">Estrutura</button><button class="p-3" :class="leftTab==='history'?'bg-slate-950 text-white':''" @click="leftTab='history'">Versões</button></div>
        <div v-if="leftTab==='blocks'" class="scroll-clean max-h-[710px] space-y-2 overflow-auto p-3"><p class="mb-2 text-xs text-slate-500">Arraste um bloco para a estrutura ou clique para adicionar.</p><button v-for="definition in blockLibrary" :key="definition.type" draggable="true" class="w-full rounded-xl border border-slate-200 p-3 text-left hover:border-teal-400 hover:bg-teal-50" @dragstart="dragLibrary($event,definition.type)" @click="addBlock(definition.type)"><div class="flex items-center gap-2"><Plus :size="15" class="text-teal-700"/><strong class="text-sm">{{definition.label}}</strong></div><p class="mt-1 text-xs leading-5 text-slate-500">{{definition.description}}</p></button></div>
        <div v-else-if="leftTab==='tree'" class="scroll-clean max-h-[710px] overflow-auto p-3"><div class="mb-2 rounded-lg border-2 border-dashed border-slate-200 p-2 text-center text-[11px] text-slate-400" @dragover.prevent @drop="dropAt($event,0)">Solte aqui para colocar no início</div><template v-for="(block,index) in documentData.blocks" :key="block.id"><button draggable="true" class="group mb-1 flex w-full items-center gap-2 rounded-xl border p-2 text-left" :class="selectedId===block.id?'border-teal-400 bg-teal-50':'border-slate-200 bg-white'" @dragstart="dragBlock($event,block.id)" @click="selectedId=block.id;rightTab='content'"><GripVertical :size="15" class="shrink-0 text-slate-400"/><div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">{{block.name}}</p><p class="text-[10px] uppercase text-slate-400">{{block.type}}</p></div></button><div class="mb-1 h-2 rounded border border-dashed border-transparent hover:border-teal-300" @dragover.prevent @drop="dropAt($event,index+1)"/></template></div>
        <div v-else class="scroll-clean max-h-[710px] space-y-2 overflow-auto p-3"><p v-if="!payload?.revisions?.length" class="py-8 text-center text-xs text-slate-400">Nenhuma versão registrada.</p><button v-for="revision in payload?.revisions||[]" :key="revision.id" class="w-full rounded-xl border border-slate-200 p-3 text-left hover:bg-slate-50" @click="restoreRevision(revision.revision)"><div class="flex items-center justify-between"><strong class="text-sm">Versão {{revision.revision}}</strong><span v-if="revision.is_published" class="badge bg-emerald-50 text-emerald-700">Publicada</span></div><p class="mt-1 text-xs text-slate-500">{{revision.note||'Sem descrição'}}</p><p class="mt-1 text-[10px] text-slate-400">{{new Date(revision.created_at).toLocaleString('pt-BR')}}</p></button></div>
      </aside>

      <section class="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-inner">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2"><div class="flex items-center gap-1"><button class="rounded-lg p-2" :class="device==='desktop'?'bg-slate-950 text-white':'text-slate-500'" @click="device='desktop'"><Monitor :size="17"/></button><button class="rounded-lg p-2" :class="device==='tablet'?'bg-slate-950 text-white':'text-slate-500'" @click="device='tablet'"><Tablet :size="17"/></button><button class="rounded-lg p-2" :class="device==='mobile'?'bg-slate-950 text-white':'text-slate-500'" @click="device='mobile'"><Smartphone :size="17"/></button></div><p class="text-xs text-slate-500">Preview em tempo real · HTML/CSS isolado em iframe</p><div class="flex items-center gap-2"><label class="flex items-center gap-2 text-xs"><input type="checkbox" :checked="payload?.enabled" @change="setEnabled(($event.target as HTMLInputElement).checked)"/>Landing habilitada</label></div></div>
        <div class="scroll-clean flex h-[710px] overflow-auto p-5"><iframe title="Preview da landing page" class="mx-auto min-h-full border-0 bg-white shadow-2xl transition-all" :style="{width:previewWidth}" :srcdoc="previewHtml" sandbox="allow-popups allow-popups-to-escape-sandbox"/></div>
      </section>

      <aside class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
        <div class="grid grid-cols-4 border-b border-slate-200 text-[11px] font-semibold"><button class="p-3" :class="rightTab==='content'?'bg-slate-950 text-white':''" @click="rightTab='content'">Conteúdo</button><button class="p-3" :class="rightTab==='style'?'bg-slate-950 text-white':''" @click="rightTab='style'">Estilo</button><button class="p-3" :class="rightTab==='page'?'bg-slate-950 text-white':''" @click="rightTab='page'">Página</button><button class="p-3" :class="rightTab==='css'?'bg-slate-950 text-white':''" @click="rightTab='css'">CSS</button></div>
        <div class="scroll-clean max-h-[710px] overflow-auto p-4">
          <template v-if="rightTab==='content'">
            <div v-if="selectedBlock" class="space-y-4"><div class="flex items-start gap-2"><LayoutTemplate :size="18" class="mt-1 text-teal-700"/><div class="min-w-0 flex-1"><input :value="selectedBlock.name" class="input !py-2 font-semibold" @focus="remember" @input="selectedBlock.name=eventValue($event);markDirty()"/><p class="mt-1 text-[10px] uppercase text-slate-400">{{selectedBlock.type}}</p></div></div><div v-for="field in contentFields" :key="field.key"><label class="label">{{field.label}}</label><textarea v-if="field.kind==='textarea'" :value="String(selectedBlock.props[field.key]||'')" class="input min-h-24" @focus="remember" @input="setProp(field.key,eventValue($event))"/><input v-else :value="String(selectedBlock.props[field.key]||'')" class="input" :placeholder="field.placeholder" @focus="remember" @input="setProp(field.key,eventValue($event))"/></div><div v-if="selectedBlock.type==='features'||selectedBlock.type==='gallery'"><label class="label">{{selectedBlock.type==='gallery'?'Imagens':'Itens'}}</label><textarea :value="itemsText(selectedBlock)" class="input min-h-40 font-mono text-xs" :placeholder="selectedBlock.type==='gallery'?'https://...|Legenda':'Título|Descrição'" @focus="remember" @input="setItemsText(eventValue($event))"/><p class="mt-1 text-xs text-slate-400">Um item por linha. Use | para separar título/descrição ou URL/legenda.</p></div><div v-if="selectedBlock.type==='html'"><label class="label">HTML personalizado</label><textarea :value="String(selectedBlock.props.html||'')" class="input min-h-80 font-mono text-xs" spellcheck="false" @focus="remember" @input="setProp('html',eventValue($event))"/><p class="mt-2 text-xs leading-5 text-amber-700">Scripts, iframes, eventos inline e protocolos executáveis são removidos pelo backend ao salvar/publicar.</p></div><div class="grid grid-cols-2 gap-2 border-t border-slate-100 pt-4"><button class="btn-secondary !px-2" @click="moveBlock(selectedBlock,-1)"><ArrowUp :size="15"/>Subir</button><button class="btn-secondary !px-2" @click="moveBlock(selectedBlock,1)"><ArrowDown :size="15"/>Descer</button><button class="btn-secondary !px-2" @click="duplicateBlock(selectedBlock)"><Copy :size="15"/>Duplicar</button><button class="btn-secondary !px-2 text-rose-600" @click="removeBlock(selectedBlock)"><Trash2 :size="15"/>Remover</button></div></div>
            <p v-else class="py-10 text-center text-sm text-slate-400">Selecione um bloco na estrutura.</p>
          </template>
          <template v-else-if="rightTab==='style'">
            <div v-if="selectedBlock" class="space-y-4"><div class="flex items-center gap-2"><Palette :size="18" class="text-teal-700"/><strong>Estilo do bloco</strong></div><div><label class="label">Fundo</label><div class="flex gap-2"><input type="color" :value="String(selectedBlock.style.background||'#ffffff')" class="h-11 w-14 rounded-lg border border-slate-200" @focus="remember" @input="setStyle('background',eventValue($event))"/><input :value="String(selectedBlock.style.background||'')" class="input" @focus="remember" @input="setStyle('background',eventValue($event))"/></div></div><div><label class="label">Cor do texto</label><div class="flex gap-2"><input type="color" :value="String(selectedBlock.style.color||'#0f172a')" class="h-11 w-14 rounded-lg border border-slate-200" @focus="remember" @input="setStyle('color',eventValue($event))"/><input :value="String(selectedBlock.style.color||'')" class="input" @focus="remember" @input="setStyle('color',eventValue($event))"/></div></div><div><label class="label">Cor de destaque</label><input :value="String(selectedBlock.style.accent||'')" class="input" placeholder="#53d5b0" @focus="remember" @input="setStyle('accent',eventValue($event))"/></div><div><label class="label">Espaçamento interno</label><input :value="String(selectedBlock.style.padding||'')" class="input" placeholder="64px 24px" @focus="remember" @input="setStyle('padding',eventValue($event))"/></div><div><label class="label">Altura mínima</label><input :value="String(selectedBlock.style.minHeight||'')" class="input" placeholder="auto ou 600px" @focus="remember" @input="setStyle('minHeight',eventValue($event))"/></div><div><label class="label">Alinhamento</label><select :value="String(selectedBlock.style.textAlign||'left')" class="select" @focus="remember" @change="setStyle('textAlign',eventValue($event))"><option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option></select></div></div><p v-else class="py-10 text-center text-sm text-slate-400">Selecione um bloco.</p>
          </template>
          <template v-else-if="rightTab==='page'">
            <div class="space-y-4"><div class="flex items-center gap-2"><Laptop :size="18" class="text-teal-700"/><strong>Identidade e SEO</strong></div><div><label class="label">Nome público</label><input :value="String(documentData.meta.brand_name||'')" class="input" @focus="remember" @input="setMeta('brand_name',eventValue($event))"/></div><label class="flex items-center gap-2 text-sm"><input type="checkbox" :checked="documentData.meta.show_brand!==false" @change="remember();setMeta('show_brand',($event.target as HTMLInputElement).checked)"/>Exibir marca no topo</label><div><label class="label">Título SEO</label><input :value="String(documentData.meta.seo_title||'')" class="input" @focus="remember" @input="setMeta('seo_title',eventValue($event))"/></div><div><label class="label">Descrição SEO</label><textarea :value="String(documentData.meta.seo_description||'')" class="input min-h-24" @focus="remember" @input="setMeta('seo_description',eventValue($event))"/></div><div class="border-t border-slate-100 pt-4"><p class="mb-3 font-semibold">Tema global</p><div class="space-y-3"><div><label class="label">Cor da página</label><input :value="String(documentData.theme.page_background||'')" class="input" @focus="remember" @input="setTheme('page_background',eventValue($event))"/></div><div><label class="label">Cor principal</label><input :value="String(documentData.theme.primary_color||'')" class="input" @focus="remember" @input="setTheme('primary_color',eventValue($event))"/></div><div><label class="label">Cor de destaque</label><input :value="String(documentData.theme.accent_color||'')" class="input" @focus="remember" @input="setTheme('accent_color',eventValue($event))"/></div><div><label class="label">Largura máxima</label><input :value="String(documentData.theme.content_width||'')" class="input" placeholder="1120px" @focus="remember" @input="setTheme('content_width',eventValue($event))"/></div><div><label class="label">Raio dos cards</label><input :value="String(documentData.theme.radius||'')" class="input" placeholder="18px" @focus="remember" @input="setTheme('radius',eventValue($event))"/></div><div><label class="label">Família tipográfica</label><textarea :value="String(documentData.theme.font_family||'')" class="input min-h-20 font-mono text-xs" @focus="remember" @input="setTheme('font_family',eventValue($event))"/></div></div></div></div>
          </template>
          <template v-else>
            <div class="space-y-3"><div class="flex items-center gap-2"><Code2 :size="18" class="text-teal-700"/><strong>CSS personalizado</strong></div><p class="text-xs leading-5 text-slate-500">Aplicado em tempo real ao preview e isolado à landing page publicada.</p><textarea v-model="customCss" class="input min-h-[560px] font-mono text-[11px] leading-5" spellcheck="false" placeholder="/* CSS personalizado */\n.lp-section { ... }" @focus="remember" @input="markDirty"/></div>
          </template>
        </div>
      </aside>
    </div>
    <footer class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500"><span><CheckCircle2 :size="14" class="mr-1 inline text-emerald-600"/>Rascunho e publicação são independentes; versões publicadas permanecem restauráveis.</span><span>HTML customizado sem JavaScript · CSS em tempo real · preview responsivo</span></footer>
  </div>
</template>
