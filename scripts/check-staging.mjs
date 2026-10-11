import assert from 'node:assert/strict';
const url=new URL(process.argv[2]||'https://invalid.example');
if(url.protocol!=='https:'||!/^snapmovienow-edge-staging\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname)||url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Provide only the HTTPS workers.dev origin of snapmovienow-edge-staging.');
const check=async(path,init={})=>{
 const response=await fetch(new URL(path,url),{...init,redirect:'error',signal:AbortSignal.timeout(15000)});
 assert.equal(response.headers.get('X-SMN-Environment'),'staging','the remote endpoint must identify itself as staging');
 return response;
};
assert.equal((await(await check('/api/health')).json()).ok,true);
for(const page of ['/index.html','/admin.html'])assert.match(await(await check(page)).text(),/ENTORNO DE PRUEBAS/);
const config=await(await check('/app-config.js')).text();
assert.match(config,/location.origin\+'\/api'/);assert.ok(!config.includes('api.snaptvnow.com'));
const admin=await check('/api/admin',{method:'POST',headers:{Origin:url.origin,'Content-Type':'application/json'},body:JSON.stringify({action:'users'})});
assert.equal(admin.status,401,'administrative data requires test authentication');
const foreign=await check('/api/admin',{method:'POST',headers:{Origin:'https://app.snaptvnow.com','Content-Type':'application/json'},body:JSON.stringify({action:'status'})});
assert.equal(foreign.status,403,'the production frontend cannot call the staging panel');
console.log('PASS: remote staging health, separate web/API, visible test label, protected panel and production-origin rejection. No accounts or settings were modified.');
