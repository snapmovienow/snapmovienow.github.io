// Owner-requested alternative. The current program and clock were compared with
// Willax's published schedule; this relay is not presented as an official CDN.
// Keep the saved catalog address HTTPS. Only this channel's signed media path
// can use the one public HTTP origin below; catalog inputs/posters stay HTTPS.
export const WILLAX_CHANNEL={
 id:'public-willax-peru',name:'Willax TV · señal alternativa',
 page:'https://willax.pe/en-vivo',adapter:'willax-public',
 categories:['peru'],xtreamId:'2000023',poster:'',
 plot:'Willax TV de Perú. Señal alternativa; disponibilidad y programación sujetas al origen.'
};
export const WILLAX_FOLDER={key:'peru',upstreamId:'112',name:'Perú',aliases:['PERU','CANALES-PERU','CANALES PERU','PERU HD']};
export const WILLAX_MEDIA_ROOT='http://190.93.224.42/WILLAX/index.m3u8';
export const isWillaxPage=value=>(value instanceof URL?value.href:value)===WILLAX_CHANNEL.page;

// Reject ambiguous raw spellings before URL normalization. There are no
// credentials, query tokens, keys, arbitrary ports, hosts or channel paths.
export function isWillaxMediaURL(value){
 const raw=value instanceof URL?value.href:value;
 if(typeof raw!=='string'||raw.length>240||!raw.startsWith('http://190.93.224.42/')||/[\\%?#\s\u0000-\u001f\u007f]/.test(raw)||/\/(?:\.|\.\.)(?:\/|$)/.test(raw))return false;
 let u;try{u=new URL(raw);}catch{return false;}
 if(u.protocol!=='http:'||u.hostname!=='190.93.224.42'||u.port||u.username||u.password||u.search||u.hash||u.href!==raw)return false;
 return u.pathname==='/WILLAX/index.m3u8'||u.pathname==='/WILLAX/tracks-v1a1/mono.ts.m3u8'||/^\/WILLAX\/tracks-v1a1\/\d{4}\/(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])\/(?:[01]\d|2[0-3])\/[0-5]\d\/[0-5]\d-\d{5}\.ts$/.test(u.pathname);
}

export function willaxMediaReferenceURL(value,base){
 if(typeof value!=='string'||value.length>240||/[\\%?#\s\u0000-\u001f\u007f]/.test(value)||/(?:^|\/)(?:\.|\.\.)(?:\/|$)/.test(value)||!isWillaxMediaURL(base))return null;
 try{const destination=new URL(value,base).href;return isWillaxMediaURL(destination)?destination:null;}catch{return null;}
}
