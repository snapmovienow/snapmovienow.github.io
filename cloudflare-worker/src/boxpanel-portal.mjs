import {mountBoxPanel,BOXPANEL_CSS} from '../../boxpanel-view.js';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Strict-Transport-Security':'max-age=31536000'};
const csp="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
export function boxpanelAsset(path,base){
 if(path==='/assets/boxpanel.css')return new Response(BOXPANEL_CSS,{headers:{...headers,'Content-Type':'text/css; charset=utf-8'}});
 if(path==='/assets/boxpanel.js'){
  const script=`const base=document.documentElement.dataset.portalBase;let view;const api=async(action,data={})=>{const r=await fetch(base+'/api/boxpanel',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,action}),signal:AbortSignal.timeout(25000)}),v=await r.json();if(!r.ok){if(r.status===401){view?.clear();document.querySelector('[data-session]').hidden=false;}throw Error(v.error||'box_unavailable');}return v;};view=(${mountBoxPanel.toString()})({api,container:document.querySelector('main'),onClose:()=>location.assign(base||'/')});view.focus();`;
  return new Response(script,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
 }
 if(path==='/boxpanel')return new Response(`<!doctype html><html lang="es" data-portal-base="${base}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#041521"><title>BOXPANEL · Publicidad y DNS</title><link rel="stylesheet" href="${base}/assets/boxpanel.css?v=1"></head><body class="bp-page"><main><a href="${base||'/'}">← Regresar a mi panel</a><p data-session hidden>Inicia sesión en tu panel reseller y vuelve a abrir BoxPanel.</p></main><script src="${base}/assets/boxpanel.js?v=1" defer></script></body></html>`,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp}});
 return null;
}
