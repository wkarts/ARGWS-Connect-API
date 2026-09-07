import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { execFileSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'); const src=path.join(root,'src');
const files=[]; const walk=(dir)=>fs.readdirSync(dir,{withFileTypes:true}).forEach(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.name.endsWith('.js')&&files.push(path.join(dir,e.name))); walk(src);
for(const file of files) execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const forbidden=['github.com/wkarts','Postman','Discord','Suporte Premium','Support Premium'];
for(const file of files){const text=fs.readFileSync(file,'utf8');for(const token of forbidden)if(text.includes(token))throw new Error(`Conteúdo público proibido em ${path.relative(root,file)}: ${token}`)}
const sidebar=fs.readFileSync(path.join(src,'components','shell.js'),'utf8'); if(!sidebar.includes('Documentação'))throw new Error('Link condicional de documentação não encontrado.');
const login=fs.readFileSync(path.join(src,'pages','login.js'),'utf8'); if(!/button\('Entrar',[\s\S]*?type:\s*'submit'/.test(login))throw new Error('O botão Entrar precisa ser type="submit" para disparar a autenticação.');
console.log(`OK: ${files.length} módulos JS validados.`);

const instances=fs.readFileSync(path.join(src,'pages','instances.js'),'utf8'); if(!instances.includes('randomUUID().toUpperCase()'))throw new Error('Token novo deve preservar formato UUID com hifens.'); if(instances.includes('businessId: businessId.value.trim() || null'))throw new Error('businessId opcional nao pode ser enviado como null.'); if(!instances.includes('Nenhuma conexão configurada'))throw new Error('Estado vazio de instancias ausente.');
const shellVoice=fs.readFileSync(path.join(src,'components','shell.js'),'utf8'); if(!shellVoice.includes('Chamadas WhatsApp')||!shellVoice.includes("'VoIP'"))throw new Error('Menus de voz Zapo ausentes.');
