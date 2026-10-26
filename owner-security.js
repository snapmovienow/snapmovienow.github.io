// Dedicated authenticated entry. Never loads dashboard modules or retries a launch.
export function mountOwnerSecurity(root,{request=fetch,storage=sessionStorage,navigate=url=>location.assign(url),origin=location.origin}={}){
 const button=root.querySelector('[data-open]'),status=root.querySelector('[data-status]');let attempted=false;
 button.addEventListener('click',async()=>{
  if(attempted)return;attempted=true;button.disabled=true;
  if(origin!=='https://app.snaptvnow.com'){status.textContent='Este acceso solo está disponible en app.snaptvnow.com.';return;}
  status.textContent='Verificando la sesión del administrador…';
  try{
   const token=storage.getItem('smn_admin_token');
   const response=await request('https://api.snaptvnow.com/admin',{method:'POST',credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reseller-admin-launch',purpose:'gateway-rotation',browser_cookie:true,...(token&&token!=='cookie'?{access_token:token}:{})}),signal:AbortSignal.timeout(16000)});
   if(!response.ok)throw Error(response.status===401?'session':'launch');
   const value=await response.json(),url=new URL(value.url);
   if(value.ok!==true||url.origin!=='https://api.snaptvnow.com'||url.pathname!=='/owner-panel/security/enter'||url.searchParams.size!==1||url.hash||url.username||url.password||!/^[A-Za-z0-9_-]{40,2000}$/.test(url.searchParams.get('code')||''))throw Error('reply');
   navigate(url.href);
  }catch{status.textContent='No se abrió el control. Comprueba tu sesión del administrador antes de volver a intentar; no se repetirá automáticamente.';}
 });
}
