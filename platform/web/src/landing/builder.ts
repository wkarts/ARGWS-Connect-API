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

const ALLOWED_BLOCK_STYLES:Record<string,string>={
  background:'background',color:'color',padding:'padding',minHeight:'min-height',textAlign:'text-align',
  borderRadius:'border-radius',margin:'margin',maxWidth:'max-width',fontSize:'font-size',fontWeight:'font-weight',
  display:'display',alignItems:'align-items',justifyContent:'justify-content',gap:'gap',
}
const ALLOWED_HTML_TAGS=new Set(['div','p','h1','h2','h3','h4','h5','h6','span','strong','em','b','i','u','ul','ol','li','blockquote','br','hr','a','img','figure','figcaption','section','article'])
const DROP_HTML_TAGS=new Set(['script','style','iframe','object','embed','svg','math','template','form','input','button','link','meta','base'])

function safeUrl(value:unknown):string{
  const raw=String(value??'').trim()
  if(!raw)return''
  if(raw.startsWith('#')||raw.startsWith('/'))return raw
  try{
    const parsed=new URL(raw,'https://connect.invalid')
    return ['http:','https:','mailto:','tel:'].includes(parsed.protocol.toLowerCase())?raw:''
  }catch{return''}
}

function safeCssValue(value:unknown,fallback=''):string{
  const raw=String(value??'').trim()
  if(!raw)return fallback
  if(/[;{}<>]/.test(raw)||/@import\b|expression\s*\(|javascript\s*:/i.test(raw))return fallback
  return raw
}

function safeCustomCss(value:unknown):string{
  return String(value??'')
    .replace(/@import\b[^;]*;?/gi,'')
    .replace(/expression\s*\(/gi,'')
    .replace(/javascript\s*:/gi,'')
    .replace(/[<>]/g,'')
}

function safeDimension(value:unknown,fallback='48px'):string{
  const raw=String(value??'').trim()
  return /^\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)$/i.test(raw)?raw:fallback
}

function applyBlockStyle(element:HTMLElement,style:Record<string,unknown>):void{
  for(const [key,value] of Object.entries(style||{})){
    const property=ALLOWED_BLOCK_STYLES[key]
    if(!property)continue
    const safe=safeCssValue(value)
    if(safe)element.style.setProperty(property,safe)
  }
}

function sanitizeClass(value:string|null):string{
  return String(value??'').split(/\s+/).filter(token=>/^[A-Za-z0-9_-]{1,64}$/.test(token)).join(' ')
}

function appendSanitizedChildren(source:Node,target:Node,doc:Document):void{
  for(const child of Array.from(source.childNodes)){
    if(child.nodeType===3){
      target.appendChild(doc.createTextNode(child.textContent||''))
      continue
    }
    if(child.nodeType!==1)continue
    const element=child as Element
    const tag=element.tagName.toLowerCase()
    if(DROP_HTML_TAGS.has(tag))continue
    if(!ALLOWED_HTML_TAGS.has(tag)){
      appendSanitizedChildren(element,target,doc)
      continue
    }

    const clone=doc.createElement(tag)
    const className=sanitizeClass(element.getAttribute('class'))
    if(className)clone.className=className
    const title=element.getAttribute('title')
    if(title)clone.setAttribute('title',title)
    const ariaLabel=element.getAttribute('aria-label')
    if(ariaLabel)clone.setAttribute('aria-label',ariaLabel)

    if(tag==='a'){
      const href=safeUrl(element.getAttribute('href'))
      if(href){
        const anchor=clone as HTMLAnchorElement
        anchor.setAttribute('href',href)
        if(/^https?:\/\//i.test(href)){
          anchor.target='_blank'
          anchor.rel='noopener noreferrer'
        }
      }
    }

    if(tag==='img'){
      const src=safeUrl(element.getAttribute('src'))
      if(!src)continue
      const image=clone as HTMLImageElement
      image.setAttribute('src',src)
      image.alt=element.getAttribute('alt')||''
      image.loading='lazy'
      const width=element.getAttribute('width')
      const height=element.getAttribute('height')
      if(width&&/^\d{1,4}$/.test(width))image.setAttribute('width',width)
      if(height&&/^\d{1,4}$/.test(height))image.setAttribute('height',height)
    }

    appendSanitizedChildren(element,clone,doc)
    target.appendChild(clone)
  }
}

function sanitizedHtmlFragment(doc:Document,value:unknown):DocumentFragment{
  const fragment=doc.createDocumentFragment()
  const parsed=new DOMParser().parseFromString(String(value??''),'text/html')
  appendSanitizedChildren(parsed.body,fragment,doc)
  return fragment
}

function sectionWithContent(doc:Document,style:Record<string,unknown>,extraClass=''):{section:HTMLElement;content:HTMLElement}{
  const section=doc.createElement('section')
  section.className=`lp-section${extraClass?` ${extraClass}`:''}`
  applyBlockStyle(section,style)
  const content=doc.createElement('div')
  content.className='lp-content'
  section.appendChild(content)
  return{section,content}
}

function appendLead(doc:Document,parent:HTMLElement,value:unknown):void{
  if(!value)return
  const paragraph=doc.createElement('p')
  paragraph.className='lp-lead'
  paragraph.textContent=String(value)
  parent.appendChild(paragraph)
}

function appendButton(doc:Document,parent:HTMLElement,label:unknown,url:unknown,primary=true):void{
  const href=safeUrl(url)
  if(!label||!href)return
  const anchor=doc.createElement('a')
  anchor.className=`lp-btn${primary?' primary':''}`
  anchor.setAttribute('href',href)
  if(/^https?:\/\//i.test(href)){
    anchor.target='_blank'
    anchor.rel='noopener noreferrer'
  }
  anchor.textContent=String(label)
  parent.appendChild(anchor)
}

function renderBlock(doc:Document,block:LandingBlock,plans:Array<Record<string,unknown>>,money:(value:unknown)=>string):HTMLElement|null{
  const p=block.props||{}
  const s=block.style||{}

  if(block.type==='hero'){
    const {section,content}=sectionWithContent(doc,s)
    if(p.eyebrow){const eyebrow=doc.createElement('div');eyebrow.className='lp-eyebrow';eyebrow.textContent=String(p.eyebrow);content.appendChild(eyebrow)}
    const title=doc.createElement('h1');title.className='lp-title';title.textContent=String(p.title??'');content.appendChild(title)
    appendLead(doc,content,p.text)
    const actions=doc.createElement('div');actions.className='lp-actions';appendButton(doc,actions,p.button_label,p.button_url,true);appendButton(doc,actions,p.secondary_label,p.secondary_url,false);content.appendChild(actions)
    return section
  }

  if(block.type==='text'){
    const {section,content}=sectionWithContent(doc,s)
    if(p.title){const title=doc.createElement('h2');title.className='lp-section-title';title.textContent=String(p.title);content.appendChild(title)}
    appendLead(doc,content,p.text)
    return section
  }

  if(block.type==='features'){
    const {section,content}=sectionWithContent(doc,s)
    const title=doc.createElement('h2');title.className='lp-section-title';title.textContent=String(p.title??'Benefícios');content.appendChild(title)
    appendLead(doc,content,p.text)
    const grid=doc.createElement('div');grid.className='lp-grid cols-3';grid.style.marginTop='28px'
    const items=Array.isArray(p.items)?p.items:[]
    items.forEach((item,index)=>{
      const obj=item&&typeof item==='object'?item as Record<string,unknown>:{title:item,text:''}
      const card=doc.createElement('article');card.className='lp-card'
      const heading=doc.createElement('h3');heading.textContent=String(obj.title??`Benefício ${index+1}`);card.appendChild(heading)
      if(obj.text){const text=doc.createElement('p');text.textContent=String(obj.text);card.appendChild(text)}
      grid.appendChild(card)
    })
    content.appendChild(grid)
    return section
  }

  if(block.type==='plans'){
    const {section,content}=sectionWithContent(doc,s)
    const title=doc.createElement('h2');title.className='lp-section-title';title.textContent=String(p.title??'Planos');content.appendChild(title)
    appendLead(doc,content,p.text)
    const grid=doc.createElement('div');grid.className='lp-grid cols-3';grid.style.marginTop='28px'
    plans.forEach(plan=>{
      const card=doc.createElement('article');card.className='lp-card'
      const heading=doc.createElement('h3');heading.textContent=String(plan.name??'Plano');card.appendChild(heading)
      if(plan.description){const text=doc.createElement('p');text.textContent=String(plan.description);card.appendChild(text)}
      const price=doc.createElement('div');price.className='lp-price';price.textContent=Number(plan.monthly_price)>0?money(plan.monthly_price):'Sob consulta';card.appendChild(price)
      grid.appendChild(card)
    })
    content.appendChild(grid)
    return section
  }

  if(block.type==='image'){
    const url=safeUrl(p.url)
    if(!url)return null
    const {section,content}=sectionWithContent(doc,s)
    const imageWrap=doc.createElement('div');imageWrap.className='lp-image'
    const image=doc.createElement('img');image.setAttribute('src',url);image.alt=String(p.alt??'Imagem');image.loading='lazy';imageWrap.appendChild(image)
    const link=safeUrl(p.link_url)
    if(link){const anchor=doc.createElement('a');anchor.setAttribute('href',link);if(/^https?:\/\//i.test(link)){anchor.target='_blank';anchor.rel='noopener noreferrer'};anchor.appendChild(imageWrap);content.appendChild(anchor)}else content.appendChild(imageWrap)
    if(p.caption){const caption=doc.createElement('div');caption.className='lp-caption';caption.textContent=String(p.caption);content.appendChild(caption)}
    return section
  }

  if(block.type==='gallery'){
    const {section,content}=sectionWithContent(doc,s)
    if(p.title){const title=doc.createElement('h2');title.className='lp-section-title';title.textContent=String(p.title);content.appendChild(title)}
    const grid=doc.createElement('div');grid.className='lp-grid cols-2';grid.style.marginTop='28px'
    const items=Array.isArray(p.items)?p.items:[]
    items.forEach(item=>{
      const obj=item&&typeof item==='object'?item as Record<string,unknown>:{url:item,caption:''}
      const url=safeUrl(obj.url)
      if(!url)return
      const figure=doc.createElement('figure')
      const wrap=doc.createElement('div');wrap.className='lp-image'
      const image=doc.createElement('img');image.setAttribute('src',url);image.alt=String(obj.caption??'Imagem da plataforma');image.loading='lazy';wrap.appendChild(image);figure.appendChild(wrap)
      if(obj.caption){const caption=doc.createElement('figcaption');caption.className='lp-caption';caption.textContent=String(obj.caption);figure.appendChild(caption)}
      grid.appendChild(figure)
    })
    content.appendChild(grid)
    return section
  }

  if(block.type==='cta'){
    const {section,content}=sectionWithContent(doc,s)
    const title=doc.createElement('h2');title.className='lp-section-title';title.textContent=String(p.title??'');content.appendChild(title)
    appendLead(doc,content,p.text)
    const actions=doc.createElement('div');actions.className='lp-actions';appendButton(doc,actions,p.button_label,p.button_url,true);content.appendChild(actions)
    return section
  }

  if(block.type==='divider'){
    const {section,content}=sectionWithContent(doc,s)
    const divider=doc.createElement('div');divider.className='lp-divider';content.appendChild(divider)
    return section
  }

  if(block.type==='spacer'){
    const spacer=doc.createElement('div');spacer.setAttribute('aria-hidden','true');spacer.style.height=safeDimension(p.height);return spacer
  }

  if(block.type==='html'){
    const {section,content}=sectionWithContent(doc,s,'lp-html')
    content.appendChild(sanitizedHtmlFragment(doc,p.html))
    return section
  }

  return null
}

const BASE_PREVIEW_CSS=`
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--text);font-family:var(--font);line-height:1.55}.lp-wrap,.lp-content{width:min(var(--width),calc(100% - 32px));margin:auto}.lp-brandbar{background:#081722;color:white}.lp-brandbar>.lp-wrap{height:64px;display:flex;align-items:center;gap:10px}.lp-mark{display:grid;width:36px;height:36px;place-items:center;border-radius:11px;background:var(--accent);color:#062019;font-weight:900}.lp-brand{font-weight:800}.lp-section{overflow:hidden}.lp-eyebrow{font-size:12px;font-weight:900;letter-spacing:.14em;color:var(--accent)}.lp-title{margin:12px 0 0;font-size:clamp(34px,5vw,64px);line-height:1.04;letter-spacing:-.045em}.lp-section-title{margin:0;font-size:clamp(26px,4vw,42px)}.lp-lead{max-width:760px;margin:18px 0 0;font-size:18px;opacity:.78}.lp-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:26px}.lp-btn{display:inline-flex;padding:11px 18px;border:1px solid #cbd5e1;border-radius:12px;font-weight:800;text-decoration:none;color:inherit}.lp-btn.primary{background:var(--accent);color:#062019;border-color:transparent}.lp-grid{display:grid;gap:16px}.lp-grid.cols-3{grid-template-columns:repeat(3,1fr)}.lp-grid.cols-2{grid-template-columns:repeat(2,1fr)}.lp-card{border:1px solid #e2e8f0;border-radius:var(--radius);padding:22px;background:rgba(255,255,255,.82)}.lp-card h3{margin:0}.lp-card p{opacity:.72}.lp-price{font-size:26px;font-weight:900;margin-top:16px}.lp-image{overflow:hidden;border-radius:var(--radius)}.lp-image img{display:block;width:100%}.lp-caption{font-size:12px;opacity:.6;margin-top:8px}.lp-divider{height:1px;background:#cbd5e1}@media(max-width:760px){.lp-grid.cols-3,.lp-grid.cols-2{grid-template-columns:1fr}}
`

export function renderPreview(documentData:LandingDocument,customCss:string,plans:Array<Record<string,unknown>>=[]):string{
  const doc=document.implementation.createHTMLDocument('Connect|API Platform')
  doc.documentElement.lang='pt-BR'
  const theme=documentData.theme||{}
  const meta=documentData.meta||{}

  const charset=doc.createElement('meta');charset.setAttribute('charset','utf-8')
  const viewport=doc.createElement('meta');viewport.name='viewport';viewport.content='width=device-width,initial-scale=1'
  const baseStyle=doc.createElement('style');baseStyle.textContent=BASE_PREVIEW_CSS
  const customStyle=doc.createElement('style');customStyle.textContent=safeCustomCss(customCss)
  doc.head.replaceChildren(charset,viewport,baseStyle,customStyle)
  doc.title=String(meta.seo_title||meta.brand_name||'Connect|API Platform')

  const rootStyle=doc.documentElement.style
  rootStyle.setProperty('--page',safeCssValue(theme.page_background,'#f8fafc'))
  rootStyle.setProperty('--text',safeCssValue(theme.text_color,'#0f172a'))
  rootStyle.setProperty('--primary',safeCssValue(theme.primary_color,'#0f766e'))
  rootStyle.setProperty('--accent',safeCssValue(theme.accent_color,'#53d5b0'))
  rootStyle.setProperty('--radius',safeCssValue(theme.radius,'18px'))
  rootStyle.setProperty('--width',safeCssValue(theme.content_width,'1120px'))
  rootStyle.setProperty('--font',safeCssValue(theme.font_family,'Inter,ui-sans-serif,system-ui,sans-serif'))

  doc.body.replaceChildren()
  if(meta.show_brand!==false){
    const nav=doc.createElement('nav');nav.className='lp-brandbar'
    const wrap=doc.createElement('div');wrap.className='lp-wrap'
    const mark=doc.createElement('span');mark.className='lp-mark';mark.textContent='C|'
    const brand=doc.createElement('span');brand.className='lp-brand';brand.textContent=String(meta.brand_name||'Connect|API Platform')
    wrap.append(mark,brand);nav.appendChild(wrap);doc.body.appendChild(nav)
  }

  const main=doc.createElement('main')
  const money=(value:unknown)=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
  for(const block of documentData.blocks||[]){const rendered=renderBlock(doc,block,plans,money);if(rendered)main.appendChild(rendered)}
  doc.body.appendChild(main)

  return`<!doctype html>\n${doc.documentElement.outerHTML}`
}
