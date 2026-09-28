#!/usr/bin/env node
'use strict';
// Internal-only one-time bootstrap. Never resets users or changes existing passwords.
const root = process.env.TRACCAR_INTERNAL_URL || 'http://traccar:8082';
const email = process.env.TRACCAR_ADMIN_EMAIL;
const password = process.env.TRACCAR_ADMIN_PASSWORD;
async function main() {
  if (!email || !password || password.length < 32) throw new Error('Segredos Traccar nao preparados.');
  let cookie = '';
  async function request(path, method='GET', data, form=false) {
    const response = await fetch(root+path, { method, redirect:'error', signal:AbortSignal.timeout(15000),
      headers:{ ...(cookie?{Cookie:cookie}:{}), ...(data?{'Content-Type':form?'application/x-www-form-urlencoded':'application/json'}:{}) },
      body:data ? form ? new URLSearchParams(data).toString() : JSON.stringify(data) : undefined });
    if(!response.ok) throw new Error('Traccar bootstrap recusado (HTTP '+response.status+').');
    const set = response.headers.getSetCookie().map(x=>x.split(';')[0]).find(x=>x.startsWith('JSESSIONID=')); if(set) cookie=set;
    return response.status===204?null:response.json();
  }
  let server;
  for(let n=0;n<40;n++) {try {server=await request('/api/server');break;}catch {if(n===39)throw new Error('Traccar indisponivel no bootstrap.');await new Promise(r=>setTimeout(r,3000));}}
  if(server.newServer===true) await request('/api/users','POST',{name:'Connect internal service',email,password});
  await request('/api/session','POST',{email,password},true);
  server=await request('/api/server');
  if(server.registration) await request('/api/server','PUT',{...server,registration:false});
  console.log('Traccar interno validado. Registro publico desabilitado; credenciais existentes preservadas.');
}
main().catch(()=>{console.error('Falha ao preparar Traccar. Verifique os segredos sem apagar usuarios/volumes. A API principal nao depende deste bootstrap.');process.exitCode=1;});
