export type LandingBlockType = 'hero'|'text'|'features'|'plans'|'image'|'gallery'|'cta'|'divider'|'spacer'|'html'

export interface LandingBlock {
  id:string
  type:LandingBlockType
  name:string
  props:Record<string,unknown>
  style:Record<string,unknown>
}

export interface LandingDocument {
  schema_version:number
  meta:Record<string,unknown>
  theme:Record<string,unknown>
  blocks:LandingBlock[]
}

export interface LandingRevision {
  id:string
  revision:number
  note?:string|null
  is_published:boolean
  actor_id?:string|null
  created_at:string
}

export interface LandingPayload {
  id:string
  key:string
  name:string
  enabled:boolean
  draft_document:LandingDocument
  draft_css:string
  published_document:LandingDocument
  published_css:string
  current_revision:number
  published_revision?:number|null
  published_at?:string|null
  updated_at:string
  revisions:LandingRevision[]
}

export interface LandingBlockDefinition {
  type:LandingBlockType
  label:string
  description:string
  category:string
}

export const blockLibrary:LandingBlockDefinition[]=[
  {type:'hero',label:'Hero / capa',description:'Título principal, texto e botões.',category:'Estrutura'},
  {type:'text',label:'Texto',description:'Título e conteúdo editorial.',category:'Conteúdo'},
  {type:'features',label:'Benefícios',description:'Grade de benefícios comerciais.',category:'Conteúdo'},
  {type:'plans',label:'Planos',description:'Planos públicos vindos do Control Plane.',category:'Dinâmico'},
  {type:'image',label:'Imagem',description:'Imagem responsiva com legenda e link.',category:'Mídia'},
  {type:'gallery',label:'Galeria',description:'Grade de imagens selecionadas.',category:'Mídia'},
  {type:'cta',label:'Chamada para ação',description:'Bloco final com botão comercial.',category:'Conversão'},
  {type:'divider',label:'Divisor',description:'Linha visual entre seções.',category:'Estrutura'},
  {type:'spacer',label:'Espaçador',description:'Controle de espaço vertical.',category:'Estrutura'},
  {type:'html',label:'HTML personalizado',description:'HTML avançado sem JavaScript.',category:'Avançado'},
]

export function makeBlock(type:LandingBlockType):LandingBlock{
  const id=`${type}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`
  const props:Record<LandingBlockType,Record<string,unknown>>={
    hero:{eyebrow:'COMMUNICATION & INTEGRATION PLATFORM',title:'Título principal da landing page',text:'Apresente o valor do produto sem revelar detalhes internos da tecnologia.',button_label:'Falar sobre a plataforma',button_url:'',secondary_label:'',secondary_url:''},
    text:{title:'Nova seção',text:'Escreva aqui o conteúdo desta seção.'},
    features:{title:'Benefícios',text:'Explique os benefícios em linguagem comercial.',items:['Benefício principal','Segundo benefício','Terceiro benefício']},
    plans:{title:'Planos',text:'Escolha o plano que melhor atende sua operação.'},
    image:{url:'',alt:'Imagem',caption:'',link_url:''},
    gallery:{title:'Galeria',items:[]},
    cta:{title:'Vamos conversar?',text:'Entre em contato para conhecer a plataforma.',button_label:'Falar agora',button_url:''},
    divider:{},
    spacer:{height:'48px'},
    html:{html:'<div class="custom-block">\n  <h2>HTML personalizado</h2>\n  <p>Edite este conteúdo no painel lateral.</p>\n</div>'},
  }
  return {
    id,
    type,
    name:blockLibrary.find(item=>item.type===type)?.label||type,
    props:props[type],
    style:{background:'#ffffff',color:'#0f172a',padding:'64px 24px'},
  }
}

export function cloneDocument<T>(value:T):T{return JSON.parse(JSON.stringify(value)) as T}

function esc(value:unknown):string{return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]||char))}
function safeUrl(value:unknown):string{const url=String(value||'').trim();return /^(https?:\/\/|\/|#|mailto:|tel:)/i.test(url)?url:''}
function styleText(style:Record<string,unknown>):string{return Object.entries(style||{}).filter(([,value])=>value!==undefined&&value!==null&&String(value)!=='').map(([key,value])=>`${key.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())}:${String(value).replace(/[;{}<>]/g,'')}`).join(';')}
function btn(label:unknown,url:unknown,primary=true):string{const href=safeUrl(url);if(!label||!href)return'';return`<a class="lp-btn ${primary?'primary':''}" href="${esc(href)}">${esc(label)}</a>`}

export function renderPreview(documentData:LandingDocument,customCss:string,plans:Array<Record<string,unknown>>=[]):string{
  const theme=documentData.theme||{},meta=documentData.meta||{}
  const css=`
  :root{--page:${theme.page_background||'#f8fafc'};--text:${theme.text_color||'#0f172a'};--primary:${theme.primary_color||'#0f766e'};--accent:${theme.accent_color||'#53d5b0'};--radius:${theme.radius||'18px'};--width:${theme.content_width||'1120px'};--font:${theme.font_family||'Inter,ui-sans-serif,system-ui,sans-serif'}}
  *{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--text);font-family:var(--font);line-height:1.55}.lp-wrap,.lp-content{width:min(var(--width),calc(100% - 32px));margin:auto}.lp-brandbar{background:#081722;color:white}.lp-brandbar>.lp-wrap{height:64px;display:flex;align-items:center;gap:10px}.lp-mark{display:grid;width:36px;height:36px;place-items:center;border-radius:11px;background:var(--accent);color:#062019;font-weight:900}.lp-brand{font-weight:800}.lp-section{overflow:hidden}.lp-eyebrow{font-size:12px;font-weight:900;letter-spacing:.14em;color:var(--accent)}.lp-title{margin:12px 0 0;font-size:clamp(34px,5vw,64px);line-height:1.04;letter-spacing:-.045em}.lp-section-title{margin:0;font-size:clamp(26px,4vw,42px)}.lp-lead{max-width:760px;margin:18px 0 0;font-size:18px;opacity:.78}.lp-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:26px}.lp-btn{display:inline-flex;padding:11px 18px;border:1px solid #cbd5e1;border-radius:12px;font-weight:800;text-decoration:none;color:inherit}.lp-btn.primary{background:var(--accent);color:#062019;border-color:transparent}.lp-grid{display:grid;gap:16px}.lp-grid.cols-3{grid-template-columns:repeat(3,1fr)}.lp-grid.cols-2{grid-template-columns:repeat(2,1fr)}.lp-card{border:1px solid #e2e8f0;border-radius:var(--radius);padding:22px;background:rgba(255,255,255,.82)}.lp-card h3{margin:0}.lp-card p{opacity:.72}.lp-price{font-size:26px;font-weight:900;margin-top:16px}.lp-image{overflow:hidden;border-radius:var(--radius)}.lp-image img{display:block;width:100%}.lp-caption{font-size:12px;opacity:.6;margin-top:8px}.lp-divider{height:1px;background:#cbd5e1}@media(max-width:760px){.lp-grid.cols-3,.lp-grid.cols-2{grid-template-columns:1fr}}
  ${customCss||''}`
  const money=(value:unknown)=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
  const blocks=documentData.blocks.map(block=>{
    const p=block.props||{},s=block.style||{},style=styleText(s)
    if(block.type==='hero')return`<section class="lp-section" style="${style}"><div class="lp-content">${p.eyebrow?`<div class="lp-eyebrow">${esc(p.eyebrow)}</div>`:''}<h1 class="lp-title">${esc(p.title)}</h1>${p.text?`<p class="lp-lead">${esc(p.text)}</p>`:''}<div class="lp-actions">${btn(p.button_label,p.button_url,true)}${btn(p.secondary_label,p.secondary_url,false)}</div></div></section>`
    if(block.type==='text')return`<section class="lp-section" style="${style}"><div class="lp-content">${p.title?`<h2 class="lp-section-title">${esc(p.title)}</h2>`:''}${p.text?`<p class="lp-lead">${esc(p.text)}</p>`:''}</div></section>`
    if(block.type==='features'){const items=Array.isArray(p.items)?p.items:[];return`<section class="lp-section" style="${style}"><div class="lp-content"><h2 class="lp-section-title">${esc(p.title)}</h2>${p.text?`<p class="lp-lead">${esc(p.text)}</p>`:''}<div class="lp-grid cols-3" style="margin-top:28px">${items.map(item=>`<article class="lp-card"><h3>${esc(typeof item==='object'?(item as Record<string,unknown>).title:item)}</h3>${typeof item==='object'&&(item as Record<string,unknown>).text?`<p>${esc((item as Record<string,unknown>).text)}</p>`:''}</article>`).join('')}</div></div></section>`}
    if(block.type==='plans')return`<section class="lp-section" style="${style}"><div class="lp-content"><h2 class="lp-section-title">${esc(p.title)}</h2><div class="lp-grid cols-3" style="margin-top:28px">${plans.map(plan=>`<article class="lp-card"><h3>${esc(plan.name)}</h3><p>${esc(plan.description)}</p><div class="lp-price">${Number(plan.monthly_price)>0?money(plan.monthly_price):'Sob consulta'}</div></article>`).join('')}</div></div></section>`
    if(block.type==='image'){const url=safeUrl(p.url);return url?`<section class="lp-section" style="${style}"><div class="lp-content"><div class="lp-image"><img src="${esc(url)}" alt="${esc(p.alt)}"></div>${p.caption?`<div class="lp-caption">${esc(p.caption)}</div>`:''}</div></section>`:''}
    if(block.type==='gallery'){const items=Array.isArray(p.items)?p.items:[];return`<section class="lp-section" style="${style}"><div class="lp-content"><h2 class="lp-section-title">${esc(p.title)}</h2><div class="lp-grid cols-2" style="margin-top:28px">${items.map(item=>{const obj=typeof item==='object'?item as Record<string,unknown>:{url:item,caption:''};const url=safeUrl(obj.url);return url?`<figure><div class="lp-image"><img src="${esc(url)}"></div><figcaption class="lp-caption">${esc(obj.caption)}</figcaption></figure>`:''}).join('')}</div></div></section>`}
    if(block.type==='cta')return`<section class="lp-section" style="${style}"><div class="lp-content"><h2 class="lp-section-title">${esc(p.title)}</h2>${p.text?`<p class="lp-lead">${esc(p.text)}</p>`:''}<div class="lp-actions">${btn(p.button_label,p.button_url,true)}</div></div></section>`
    if(block.type==='divider')return`<section class="lp-section" style="${style}"><div class="lp-content"><div class="lp-divider"></div></div></section>`
    if(block.type==='spacer')return`<div style="height:${esc(String(p.height||'48px'))}"></div>`
    if(block.type==='html')return`<section class="lp-section" style="${style}"><div class="lp-content">${String(p.html||'')}</div></section>`
    return''
  }).join('')
  return`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${meta.show_brand===false?'':`<nav class="lp-brandbar"><div class="lp-wrap"><span class="lp-mark">AF</span><span class="lp-brand">${esc(meta.brand_name||'Connect|API Platform')}</span></div></nav>`}<main>${blocks}</main></body></html>`
}
