// Read-only XUI reseller connector. Never logs credentials or modifies provider accounts.
const BASE="http://ccf.center:8444/NYzkggyG/";
const plain=s=>String(s||'').replace(/<[^>]*>/g,'').trim().replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#0?39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
export function parseLines(data){
 if(!Array.isArray(data?.data))throw Error('panel_format_changed');
 return data.data.flatMap(r=>{if(!Array.isArray(r)||r.length<12||!/^\d+$/.test(plain(r[0])))return [];
 const username=plain(r[1]),password=plain(String(r[2]).match(/class="table-trunc-copy-cell__text[^"]*"[^>]*title="([^"]+)"/)?.[1]||String(r[2]).match(/<span[^>]*class="table-trunc-copy-cell__text[^"]*"[^>]*>([^<]*)/)?.[1]||r[2]);
 const active=/title=["']Active["']/.test(String(r[4]));const used=Number(plain(r[7])),max=Math.min(3,Number(plain(r[8])));const date=plain(r[11]).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
 if(!active||!username||!password||!Number.isFinite(used)||!Number.isInteger(max)||max<1||(date&&Date.parse(date+'T23:59:59Z')<Date.now()))return [];
 return [{id:plain(r[0]),username,password,maxConnections:max,external:used}];});
}
export async function readPanel(username,password){
 let cookie='';async function request(path,body){let url=new URL(path,BASE),method=body?'POST':'GET';for(let i=0;i<5;i++){
  if(url.origin!==new URL(BASE).origin||!url.pathname.startsWith('/NYzkggyG/'))throw Error('panel_redirect_denied');
  const r=await fetch(url,{method,redirect:'manual',headers:{'User-Agent':'SnapMovieNow/1.0',...(cookie?{Cookie:cookie}:{}),...(body?{'content-type':'application/x-www-form-urlencoded'}:{})},...(body?{body}:{}),signal:AbortSignal.timeout(20000)});
  const sc=r.headers.get('set-cookie');if(sc){const m=sc.match(/(?:^|,\s*)PHPSESSID=([^;]+)/);if(m)cookie='PHPSESSID='+m[1]}
  if([301,302,303,307,308].includes(r.status)){url=new URL(r.headers.get('location'),url);if([301,302,303].includes(r.status)){method='GET';body=undefined}continue}
  if(!r.ok)throw Error('panel_unavailable');return r.text();}throw Error('panel_redirect_failed');}
 await request('login');const text=await request('login',new URLSearchParams({username,password,login:'',referrer:''}).toString());
 if(/name=["']password["']/.test(text)||!text.includes('dashboard'))throw Error('panel_invalid');
 const lines=[];let total=0;for(let start=0;start<10000;start+=1000){const query=new URLSearchParams({id:'lines',filter:'1',reseller:'',draw:'1',start:String(start),length:'1000','search[value]':'','order[0][column]':'0','order[0][dir]':'asc'});let d;try{d=JSON.parse(await request('table?'+query))}catch(e){if(e.message.startsWith('panel_'))throw e;throw Error('panel_format_changed')}
  total=Number(d.recordsFiltered);lines.push(...parseLines(d));if(!d.data?.length||start+1000>=total)break;if(start===9000)throw Error('panel_too_many_lines');}
 if(!lines.length)throw Error('panel_no_active_lines');return lines;
}
