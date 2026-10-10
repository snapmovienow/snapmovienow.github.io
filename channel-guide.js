// Bounded EPG presentation, independent of authentication and playback.
globalThis.SMNGuide={
 text(value){const raw=typeof value==='string'?value.slice(0,4000):'';if(!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)||raw.length%4)return raw;try{const decoded=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(raw),c=>c.charCodeAt(0)));return /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(decoded)?raw:decoded}catch{return raw}},
 lines(data,now=Date.now()){
  const rows=Array.isArray(data?.epg_listings)?data.epg_listings.filter(r=>r&&typeof r==='object').slice(0,100):[];
  return rows.filter(r=>!Number.isFinite(Number(r.stop_timestamp))||Number(r.stop_timestamp)<=0||Number(r.stop_timestamp)*1000>now).slice(0,24).map(r=>{const title=this.text(r.title).slice(0,200).trim();if(!title)return '';const start=Number(r.start_timestamp)*1000,end=Number(r.stop_timestamp)*1000,format=at=>new Date(at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});return (start>0&&Number.isFinite(start)?format(start)+(end>start&&Number.isFinite(end)?'–'+format(end):'')+' · ':'')+(start<=now&&end>now?'En directo · ':'')+title}).filter(Boolean);
 }
};
