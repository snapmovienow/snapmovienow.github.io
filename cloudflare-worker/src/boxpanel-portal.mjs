import {mountBoxPanel,BOXPANEL_CSS} from '../../boxpanel-view.js';
import {mountBoxPanelApps,BOXAPP_CSS} from '../../boxpanel-apps.js';
import {BOXWEB_CSS,mountBoxWebNav,mountBoxPanelLogin} from '../../boxpanel-web.js';
import {boxWebPage,boxCatalogBody,boxLoginBody,boxPrivateBody} from './boxpanel-web-shell.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Strict-Transport-Security':'max-age=31536000'};
const csp="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
export function boxpanelAsset(path,base,{unified=true}={}){
 const html=(title,body,script,current)=>new Response(boxWebPage({base,title,body,script,unified,current}),{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp}});
 if(path==='/assets/boxpanel.css')return new Response(BOXPANEL_CSS+BOXAPP_CSS+BOXWEB_CSS,{headers:{...headers,'Content-Type':'text/css; charset=utf-8'}});
 if(path==='/assets/boxpanel-web.js')return new Response(`(${mountBoxWebNav.toString()})();`,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
 if(path==='/assets/boxpanel-login.js')return new Response(`(${mountBoxPanelLogin.toString()})();`,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
 if(path==='/boxpanel/login')return html('Acceso reseller',boxLoginBody(base),'boxpanel-login.js','login');
 if(path==='/assets/boxpanel-catalog.js'){
  const script=`const base=document.documentElement.dataset.portalBase;const section=document.querySelector('.boxpanel');const view=(${mountBoxPanelApps.toString()})({section,owner:false,publicCatalog:true,run:()=>{},onChoose:id=>{try{sessionStorage.setItem('bp_design_choice',id);}catch{}location.assign(base+'/boxpanel');}});fetch(base+'/api/boxpanel/catalog',{credentials:'omit',signal:AbortSignal.timeout(15000)}).then(async r=>{if(!r.ok)throw Error();const value=await r.json();view.setCatalog(value.catalog);view.setApp(null,null);}).catch(()=>{document.querySelector('[data-state]').textContent='No se pudo cargar el catálogo. Vuelve a abrir esta página para intentar de nuevo.';});`;
  return new Response(script,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
 }
 if(path==='/apps')return html('Web para resellers',boxCatalogBody(base),'boxpanel-catalog.js','catalog');
 if(path==='/assets/boxpanel.js'){
  const script=`const apps=(${mountBoxPanelApps.toString()});const base=document.documentElement.dataset.portalBase;let choice='';try{choice=sessionStorage.getItem('bp_design_choice')||'';}catch{}let view,closing=false;const goLogin=()=>{view?.clear();location.replace(base+'/boxpanel/login');};const api=async(action,data={})=>{const r=await fetch(base+'/api/boxpanel',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,action}),signal:AbortSignal.timeout(25000)}),v=await r.json();if(!r.ok){if(r.status===401)goLogin();throw Error(v.error||'box_unavailable');}return v;};view=(${mountBoxPanel.toString()})({api,apps:options=>apps({...options,initialDesign:choice}),container:document.querySelector('main'),onClose:()=>location.assign(base+'/apps')});const logout=document.querySelector('[data-web-logout]');logout.onclick=async()=>{if(closing)return;closing=true;logout.disabled=true;view.clear();const state=document.querySelector('[data-session]');state.textContent='Cerrando sesión…';try{const r=await fetch(base+'/api/portal/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(25000)}),v=await r.json();if(!r.ok||v.ok!==true)throw Error();goLogin();}catch{state.textContent='No se pudo confirmar el cierre de sesión. Pulsa Cerrar sesión para intentar de nuevo.';closing=false;logout.disabled=false;}};addEventListener('pagehide',()=>view.clear());addEventListener('pageshow',event=>{if(event.persisted)location.reload();});view.focus({scroll:false});`;
  return new Response(script,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
 }
 if(path==='/boxpanel')return html('Mi panel reseller',boxPrivateBody(base),'boxpanel.js','panel');
 return null;
}
