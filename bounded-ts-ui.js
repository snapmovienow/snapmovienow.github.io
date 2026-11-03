// Dedicated diagnostic control; no media element, playback fallback, or retry.
globalThis.SMNBoundedTS={init({document,getSession,getAuthenticated,config,request=fetch}){
 const box=document.createElement('section'),button=document.createElement('button'),status=document.createElement('button'),out=document.createElement('pre');
 box.hidden=true;button.type=status.type='button';button.textContent='Probar referencia 8461 una vez (15 s / 4 MB leídos)';status.textContent='Consultar resultado sin repetir prueba';out.setAttribute('aria-live','polite');box.append(button,status,out);document.getElementById('live').append(box);
 let busy=false,used=false;
 const permitted=()=>config?.boundedTsDiagnostic===true&&config?.cookieMode===true&&getAuthenticated()&&getSession()?.username==='dieguito2026';
 const update=()=>{box.hidden=!permitted();button.disabled=busy||used;status.disabled=busy};
 async function run(mode){
  if(!permitted()||busy||mode==='run'&&used)return;
  const session=getSession();busy=true;if(mode==='run')used=true;update();out.textContent='Consultando diagnóstico…';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
   const url=new URL('/bounded-ts-diagnostic',config.api);
   const response=await request(url.href,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({mode}),signal:controller.signal});
   const value=await response.json();if(getSession()!==session||!permitted())return;
   out.textContent=JSON.stringify(value,null,2);
   if(value.state==='consumed'||value.state==='complete'||value.error==='diagnostic_consumed')used=true;
  }catch{if(getSession()===session&&permitted())out.textContent='Resultado incierto. Consulta el resultado; no repitas la prueba.'}
  finally{clearTimeout(timer);controller.abort();busy=false;update()}
 }
 button.addEventListener('click',()=>run('run'));status.addEventListener('click',()=>run('status'));
 update();return {update};
}};
