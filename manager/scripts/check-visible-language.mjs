import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve('src')
const forbidden = [
  /\bmanager\b/i,
  /\bengine\b/i,
  /telemetr(?:y|ia)/i,
  /licen[cs](?:e|ing|iamento|a)/i,
  /\btenant\b/i,
  /\bpartner\b/i,
  /\bplatform\b/i,
  /\bplataforma\b/i,
  /\bfastapi\b/i,
  /\bpython\b/i,
  /\bnode(?:\.js)?\b/i,
  /\bvue(?:\.js)?\b/i,
]
const visibleRoots = ['views','layouts','components']
const failures=[]
for (const dir of visibleRoots) {
  const walk=(p)=>{for(const e of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())walk(f);else if(e.name.endsWith('.vue')){const text=fs.readFileSync(f,'utf8');const tpl=(text.match(/<template>([\s\S]*?)<\/template>/)||[])[1]||'';for(const rx of forbidden)if(rx.test(tpl))failures.push(`${f}: ${rx}`)}}}
  walk(path.join(root,dir))
}
if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log('Linguagem visível validada.')
