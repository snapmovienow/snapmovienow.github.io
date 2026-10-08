// Read-only XUI reseller connector. Never logs credentials or modifies provider accounts.
const BASE="http://ccf.center:8444/NYzkggyG/";
const plain=s=>String(s||'').replace(/<[^>]*>/g,'').trim().replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#0?39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
// Administrator metadata never contains a subscription password.
export function parseInventory(data){
 if(!Array.isArray(data?.data))throw Error('panel_format_changed');
 return data.data.flatMap(r=>{if(!Array.isArray(r)||r.length<12||!/^\d+$/.test(plain(r[0]))||!plain(r[1]))return [];
  const date=plain(r[11]).match(/^\d{4}-\d{2}-\d{2}/)?.[0],expiresAt=date?Date.parse(date+'T23:59:59Z'):null;
  const label=String(r[4]).match(/title=["']([^"']+)["']/)?.[1]||'';
  const status=(expiresAt&&expiresAt<Date.now())||/expired/i.test(label)?'expired':/^active$/i.test(label)?'active':/disabled|banned|suspend/i.test(label)?'suspended':'unavailable';
  return [{id:plain(r[0]),username:plain(r[1]),status,expiresAt:Number.isFinite(expiresAt)?expiresAt:null,maxConnections:Math.min(3,Math.max(0,Number(plain(r[8]))||0)),reported:Math.max(0,Number(plain(r[7]))||0)}];
 });
}
export function parseLines(data){
 if(!Array.isArray(data?.data))throw Error('panel_format_changed');
 return data.data.flatMap(r=>{if(!Array.isArray(r)||r.length<12||!/^\d+$/.test(plain(r[0])))return [];
 const username=plain(r[1]),password=plain(String(r[2]).match(/class="table-trunc-copy-cell__text[^"]*"[^>]*title="([^"]+)"/)?.[1]||String(r[2]).match(/<span[^>]*class="table-trunc-copy-cell__text[^"]*"[^>]*>([^<]*)/)?.[1]||r[2]);
 const active=/title=["']Active["']/.test(String(r[4]));const used=Number(plain(r[7])),max=Math.min(3,Number(plain(r[8])));const date=plain(r[11]).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
 if(!active||!username||!password||!Number.isFinite(used)||!Number.isInteger(max)||max<1||(date&&Date.parse(date+'T23:59:59Z')<Date.now()))return [];
 return [{id:plain(r[0]),username,password,maxConnections:max,external:used}];});
}
export async function readPanel(username,password,base=BASE,options={}){
 base=validateServerUrl(base,true);
 const deadline=Date.now()+45000;
 let cookie='';async function request(path,body){let url=new URL(path,base),method=body?'POST':'GET';for(let i=0;i<5;i++){
  if(url.origin!==new URL(base).origin||!url.pathname.startsWith(new URL(base).pathname))throw Error('panel_redirect_denied');
  const remaining=deadline-Date.now();if(remaining<=0)throw Error('panel_unavailable');
  const r=await fetch(url,{method,redirect:'manual',headers:{'User-Agent':'SnapMovieNow/1.0',...(cookie?{Cookie:cookie}:{}),...(body?{'content-type':'application/x-www-form-urlencoded'}:{})},...(body?{body}:{}),signal:AbortSignal.timeout(Math.min(12000,remaining))});
  const sc=r.headers.get('set-cookie');if(sc){const m=sc.match(/(?:^|,\s*)PHPSESSID=([^;]+)/);if(m)cookie='PHPSESSID='+m[1]}
  if([301,302,303,307,308].includes(r.status)){url=new URL(r.headers.get('location'),url);if([301,302,303].includes(r.status)){method='GET';body=undefined}continue}
  if(!r.ok)throw Error('panel_unavailable');return r.text();}throw Error('panel_redirect_failed');}
 await request('login');const text=await request('login',new URLSearchParams({username,password,login:'',referrer:''}).toString());
 if(/name=["']password["']/.test(text)||!text.includes('dashboard'))throw Error('panel_invalid');
 // Provider-side filters can exclude usable idle active lines. Read the full
 // authenticated inventory and validate status and expiry locally. Playback
 // also validates the selected account before use.
 const lines=[],inventory=[];let total=0;for(let start=0;start<10000;start+=1000){const query=new URLSearchParams({id:'lines',filter:'',reseller:'',draw:'1',start:String(start),length:'1000','search[value]':'','order[0][column]':'0','order[0][dir]':'asc'});let d;try{d=JSON.parse(await request('table?'+query))}catch(e){if(e.message.startsWith('panel_'))throw e;throw Error('panel_format_changed')}
  total=Number(d.recordsFiltered);lines.push(...parseLines(d));if(options.inventory)inventory.push(...parseInventory(d));if(!d.data?.length||start+1000>=total)break;if(start===9000)throw Error('panel_too_many_lines');}
 if(!lines.length&&!options.inventory)throw Error('panel_no_active_lines');return options.inventory?{lines,inventory}:lines;
}

export function validateServerUrl(value,panel=false){
 let u;try{u=new URL(String(value))}catch{throw Error('invalid_server_url')}
 const h=u.hostname.toLowerCase();if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||!h.includes('.')||h==='localhost'||h.endsWith('.local')||h.endsWith('.internal')||h.startsWith('[')||/^(?:\d{1,3}\.){3}\d{1,3}$/.test(h)||/^(?:0|10|127|169\.254|192\.168)\./.test(h)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(h))throw Error('invalid_server_url');
 if(!panel&&u.pathname!=='/')throw Error('invalid_server_url');if(panel){u.pathname=u.pathname.replace(/\/?$/,'/');return u.href}return u.origin;
}
