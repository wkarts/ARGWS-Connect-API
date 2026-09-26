'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');

function load(relative,overrides={},globals={}){
  const module={exports:{}};
  const source=fs.readFileSync(path.join(root,relative),'utf8');
  const code=ts.transpileModule(source,{fileName:relative,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{
    module,exports:module.exports,URL,Buffer,Date,console,
    process:{env:{NODE_ENV:'PROD',MANAGER_IFRAME_ENABLED:'true',MANAGER_FRAME_ANCESTORS:'*'}},
    require(name){if(Object.hasOwn(overrides,name))return overrides[name];throw new Error('Unexpected dependency '+name)},
    ...globals,
  },{filename:relative});
  return module.exports;
}

const policy=load('src/utils/managerFramePolicy.ts');
function harness(){
  let row=null;
  const delegate={
    async findUnique(){return row?{...row}:null},
    async updateMany({where,data}){
      if(!row||row.id!==where.id||row.version!==where.version)return {count:0};
      row={
        ...row,
        ...data,
        version:typeof data.version==='object'?row.version+Number(data.version.increment||0):data.version,
        updatedAt:new Date(),
      };
      return {count:1};
    },
    async create({data}){
      if(row)throw new Error('duplicate');
      row={...data,createdAt:new Date(),updatedAt:new Date()};
      return {...row};
    },
  };
  const {ManagerEmbeddingService,ManagerEmbeddingError}=load(
    'src/api/services/manager-embedding.service.ts',
    {
      '@api/repository/repository.service':{},
      '@utils/managerFramePolicy':policy,
    },
  );
  return {service:new ManagerEmbeddingService({managerEmbeddingSetting:delegate}),ManagerEmbeddingError,getRow:()=>row};
}

test('iframe origin registry uses ENV only before the first persisted save',async()=>{
  const h=harness();
  const bootstrap=await h.service.settings();
  assert.equal(bootstrap.source,'environment');
  assert.equal(bootstrap.allowAnyOrigin,true);
  assert.equal(bootstrap.effectiveFrameAncestors,'*');

  const saved=await h.service.save({
    version:1,
    enabled:true,
    allowedOrigins:['https://hub-dev.argws.com.br','https://hub.argws.com.br'],
  });
  assert.equal(saved.source,'database');
  assert.equal(saved.version,2);
  assert.equal(saved.allowAnyOrigin,false);
  assert.equal(saved.effectiveFrameAncestors,"'self' https://hub-dev.argws.com.br https://hub.argws.com.br");

  const policyAfterSave=await h.service.policy();
  assert.equal(policyAfterSave.frameAncestors,"'self' https://hub-dev.argws.com.br https://hub.argws.com.br");
});

test('iframe origin registry rejects paths, wildcards and stale versions',async()=>{
  const h=harness();
  await assert.rejects(
    h.service.save({version:1,enabled:true,allowedOrigins:['https://hub.argws.com.br/app']}),
    /somente a origem/i,
  );
  await assert.rejects(
    h.service.save({version:1,enabled:true,allowedOrigins:['https:\/\/*.argws.com.br']}),
    /Curingas/i,
  );
  await h.service.save({version:1,enabled:true,allowedOrigins:['https://hub-dev.argws.com.br']});
  await assert.rejects(
    h.service.save({version:1,enabled:true,allowedOrigins:['https://hub.argws.com.br']}),
    (error)=>error instanceof h.ManagerEmbeddingError&&error.status===409,
  );
});

test('persisted disabled state fails closed even when ENV bootstrap is wildcard',async()=>{
  const h=harness();
  const saved=await h.service.save({version:1,enabled:false,allowedOrigins:[]});
  assert.equal(saved.source,'database');
  assert.equal(saved.enabled,false);
  assert.equal(saved.effectiveFrameAncestors,"'none'");
  assert.equal((await h.service.policy()).frameAncestors,"'none'");
});
