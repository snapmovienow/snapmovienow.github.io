// Metadata probes only: never acquire a slot, open media or expose credentials.
export async function probeProviders(providers,{decrypt,readPanel,validateAccount,identifier}){
 const results=new Array(providers.length);let cursor=0;
 await Promise.all(Array.from({length:Math.min(3,providers.length)},async()=>{
  for(;;){const i=cursor++;if(i>=providers.length)return;const p=providers[i];let ok=false;
   try{
    const credentials=await decrypt(p.encrypted||'');
    if(credentials?.kind==='reseller')ok=(await readPanel(credentials.username,credentials.password,p.url||'http://ccf.center:8444/NYzkggyG/',{inventory:true})).lines.length>0;
    else if(credentials?.kind==='provider')ok=!!await validateAccount(credentials.username,credentials.password,p.origin||credentials.origin||'http://ccf.center:8444');
   }catch{/* Return a bounded status, never exception text, URLs or usernames. */}
   results[i]={id:await identifier(p.source||String(i)),label:'Proveedor '+(i+1),ok};
  }
 }));
 return {providers:results};
}
