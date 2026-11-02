// Finite owner-approved selection, reviewed 2026-11-02. Only stable public HLS entry
// points are saved. Session URLs/signatures are discovered afresh from manifests.
export const PUBLIC_TV_FOLDERS=[
 {key:'mexico',upstreamId:'101',name:'México',aliases:['MEXICO','CANALES-MEXICO']},
 {key:'colombia',upstreamId:'102',name:'Colombia',aliases:['COLOMBIA','CANALES-COLOMBIA']},
 {key:'argentina',upstreamId:'103',name:'Argentina',aliases:['ARGENTINA','CANALES-ARGENTINA']},
 {key:'espana',upstreamId:'104',name:'España',aliases:['ESPANA','CANALES-ESPANA']},
 {key:'noticias',upstreamId:'105',name:'CANALES-NOTICIA',aliases:['CANALES-NOTICIA','CANALES-NOTICIAS','NOTICIAS','NOTICIA']},
 {key:'musica',upstreamId:'106',name:'CANALES-MUSICA',aliases:['CANALES-MUSICA','MUSICA','MUSICALES']},
 {key:'deportes',upstreamId:'107',name:'CANALES-DEPORTES',aliases:['CANALES-DEPORTES','DEPORTES']},
 {key:'infantiles',upstreamId:'108',name:'CANALES-INFANTILES',aliases:['CANALES-INFANTILES','INFANTIL','INFANTILES']},
 {key:'documentales',upstreamId:'109',name:'CANALES-DOCUMENTALES',aliases:['CANALES-DOCUMENTALES','DOCUMENTALES']},
 {key:'religiosos',upstreamId:'110',name:'CANALES-RELIGIOSOS',aliases:['CANALES-RELIGIOSOS','RELIGIOSOS','RELIGIOSO']}
];
export const PUBLIC_TV_CHANNELS=[
 {"id":"public-dw-es","name":"DW Español","page":"https://dwamdstream104.akamaized.net/hls/live/2015530/dwstream104/master.m3u8","adapter":"public-hls","categories":["noticias"],"xtreamId":"2000001","poster":"https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Deutsche_Welle_symbol_2012.svg/960px-Deutsche_Welle_symbol_2012.svg.png","plot":"Noticias, reportajes y documentales internacionales en español."},
 {"id":"public-euronews-es","name":"Euronews Español","page":"https://cdn-euronews.akamaized.net/live/eds/euronews-es/25053/index.m3u8","adapter":"public-hls","categories":["noticias"],"xtreamId":"2000002","poster":"https://provider-static.plex.tv/epg/cms/production/f7dacd88-7f26-40a6-960e-a597d8b560c5/ESLogo_Euronews_stacked_white_on_spanish_1500x1000wht.png","plot":"Noticias internacionales en español."},
 {"id":"public-rtve-24h","name":"RTVE 24 Horas","page":"https://ztnr.rtve.es/ztnr/1694255.m3u8","adapter":"public-hls","categories":["espana"],"xtreamId":"2000003","poster":"https://i.ibb.co/21sXZ3GT/24h.png","plot":"Canal informativo 24 Horas de RTVE, en español."},
 {"id":"public-adn40","name":"ADN 40","page":"https://mdstrm.com/live-stream-playlist/60b578b060947317de7b57ac.m3u8","adapter":"public-hls","categories":["mexico"],"xtreamId":"2000004","poster":"https://i.imgur.com/Og17U9N.png","plot":"Noticias y análisis de México en español."},
 {"id":"public-milenio","name":"Milenio TV","page":"https://mdstrm.com/live-stream-playlist/610178c7db32a4112d994650.m3u8","adapter":"public-hls","categories":["mexico"],"xtreamId":"2000005","poster":"https://i.imgur.com/TG1T5Oh.png","plot":"Noticias de México y el mundo en español."},
 {"id":"public-canal26","name":"Canal 26","page":"https://stream-gtlc.telecentro.net.ar/hls/canal26hls/main.m3u8","adapter":"public-hls","categories":["argentina"],"xtreamId":"2000006","poster":"https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Canal_26_logo_%282022%29.svg/500px-Canal_26_logo_%282022%29.svg.png","plot":"Noticias de Argentina y el mundo, en español."},
 {"id":"public-telesur","name":"teleSUR","page":"https://mblesmain01.telesur.ultrabase.net/mbliveMain/hd/playlist.m3u8","adapter":"public-hls","categories":["noticias"],"xtreamId":"2000007","poster":"https://i.imgur.com/P50VjRX.png","plot":"Noticias y reportajes de América Latina en español."},
 {"id":"public-senal-colombia","name":"Señal Colombia","page":"https://streaming.rtvc.gov.co/TV_Senal_Colombia_live/smil:live.smil/playlist.m3u8","adapter":"public-hls","categories":["colombia"],"xtreamId":"2000008","poster":"https://i.imgur.com/Y9x16vl.png","plot":"Cultura, documentales y entretenimiento de Colombia. Algunos programas pueden tener restricciones territoriales."},
 {"id":"public-xite-nuevo-latino","name":"XITE Nuevo Latino","page":"https://d3bsgqzbpkrvbb.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-w288eaw03izg1/XITE_Nuevo_Latino.m3u8","adapter":"public-hls","categories":["musica"],"xtreamId":"2000009","poster":"https://i.imgur.com/2qyl2y3.png","plot":"Videoclips latinos actuales. Señal gratuita con publicidad."},
 {"id":"public-xite-siempre-latino","name":"XITE Siempre Latino","page":"https://d1xc25jm9e0l4b.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-xplkt8i7m24dc/XITE_Siempre_Latino.m3u8","adapter":"public-hls","categories":["musica"],"xtreamId":"2000010","poster":"https://i.imgur.com/bwmIEgG.png","plot":"Videoclips latinos clásicos y actuales. Señal gratuita con publicidad."},
 {"id":"public-sol-musica","name":"Sol Música","page":"https://d2glyu450vvghm.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-21u4g5cjglv02/sm.m3u8","adapter":"public-hls","categories":["musica"],"xtreamId":"2000011","poster":"https://i.imgur.com/rbJrmPw.png","plot":"Música española, videoclips, conciertos y entrevistas. Incluye publicidad."},
 {"id":"public-enlace","name":"Enlace","page":"https://livecdn.enlace.plus/enlace/smil:enlace-hd.smil/playlist.m3u8","adapter":"public-hls","categories":["religiosos"],"xtreamId":"2000012","poster":"https://i.imgur.com/YwUVTmS.png","plot":"Programación cristiana en español."},
 {"id":"public-ejtv","name":"Enlace Juvenil","page":"https://livecdnusa.enlace.plus/ejtv/smil:ejtv-hd.smil/playlist.m3u8","adapter":"public-hls","categories":["religiosos"],"xtreamId":"2000013","poster":"https://i.imgur.com/GfpPQ5D.png","plot":"EJTV: música y programación cristiana juvenil en español."},
 {"id":"public-redbull","name":"Red Bull TV","page":"https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8","adapter":"public-hls","categories":["deportes"],"xtreamId":"2000014","poster":"https://i.postimg.cc/8c78JM28/image.png","plot":"Deportes de acción, aventura y documentales. Idiomas variables; programación y publicidad del proveedor."},
 {"id":"public-nhk-world","name":"NHK WORLD-JAPAN","page":"https://masterpl.hls.nhkworld.jp/hls/w/live/smarttv.m3u8","adapter":"public-hls","categories":["documentales"],"xtreamId":"2000015","poster":"https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/NHK_World.svg/960px-NHK_World.svg.png","plot":"Cultura japonesa, documentales y noticias, principalmente en inglés."},
 {"id":"public-bloomberg","name":"Bloomberg TV","page":"https://bloomberg.com/media-manifest/streams/us.m3u8","adapter":"public-hls","categories":["noticias"],"xtreamId":"2000016","poster":"https://i.imgur.com/R7FCaB5.png","plot":"Economía y noticias financieras, en inglés."},
 {"id":"public-pbs-kids","name":"PBS Kids","page":"https://livestream.pbskids.org/out/v1/14507d931bbe48a69287e4850e53443c/est.m3u8","adapter":"public-hls","categories":["infantiles"],"xtreamId":"2000017","poster":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/PBS_Kids_logo_%282022%29.svg/960px-PBS_Kids_logo_%282022%29.svg.png","plot":"Programación infantil educativa en inglés. Disponible según las condiciones territoriales del proveedor."},
 {"id":"public-classic-arts","name":"Classic Arts Showcase","page":"https://classicarts.akamaized.net/hls/live/1024257/CAS/master.m3u8","adapter":"public-hls","categories":["musica"],"xtreamId":"2000018","poster":"https://i.imgur.com/M6FFkc3.png","plot":"Música clásica, ópera, ballet y otras artes escénicas."},
 {"id":"public-vevo-pop","name":"Vevo Pop","page":"https://amg00056-amg00056c6-rakuten-uk-3235.playouts.now.amagi.tv/playlist.m3u8","adapter":"public-hls","categories":["musica"],"xtreamId":"2000019","poster":"https://i.imgur.com/dZHktKR.png","plot":"Videoclips pop, principalmente en inglés. Señal gratuita con publicidad."},
 {"id":"public-nbc-news-now","name":"NBC News NOW","page":"https://d1bl6tskrpq9ze.cloudfront.net/hls/master.m3u8?ads.xumo_channelId=99984003","adapter":"public-hls","categories":["noticias"],"xtreamId":"2000020","poster":"https://i.imgur.com/JZt2qh5.png","plot":"Noticias nacionales e internacionales en inglés. No es la señal completa de NBC ni una estación local."}
];
const begins=(u,host,prefix)=>u.hostname===host&&u.pathname.startsWith(prefix);
const path=(u,host,pattern)=>u.hostname===host&&pattern.test(u.pathname);
// Hosts and channel paths were checked against each public master and its media,
// audio/subtitle playlists and ad-stitched children. No catch-all CDN allowance.
export function publicTvMediaAllowed(channel,u){
 if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||u.hash||/%(?:2e|2f|5c)/i.test(u.pathname))return false;
 const root=new URL(channel.page);if(u.href===root.href)return true;
 switch(channel.id){
 case 'public-dw-es':return path(u,'dwamdstream104.akamaized.net',/^\/hls\/live\/2015530(?:-b)?\/dwstream104\//);
 case 'public-euronews-es':return begins(u,'cdn-euronews.akamaized.net','/live/eds/euronews-es/25053/');
 case 'public-rtve-24h':return begins(u,'rtvelivestream.rtve.es','/rtvesec/24h/')||begins(u,'rtvelivestream.rtve.es','/proxy_subtitulos/');
 case 'public-adn40':case 'public-milenio':{
  const id=channel.id==='public-adn40'?'60b578b060947317de7b57ac':'610178c7db32a4112d994650';
  return /^[a-z0-9-]+\.cdn\.mdstrm\.com$/.test(u.hostname)&&(u.pathname.startsWith('/live-stream/'+id+'/')||u.pathname.startsWith('/live-stream-gdai/'+id+'/'));
 }
 case 'public-canal26':return begins(u,'stream-gtlc.telecentro.net.ar','/hls/canal26hls/');
 case 'public-telesur':return begins(u,'mblesmain01.telesur.ultrabase.net','/mbliveMain/hd/');
 case 'public-senal-colombia':return begins(u,'streaming.rtvc.gov.co','/TV_Senal_Colombia_live/');
 case 'public-xite-nuevo-latino':case 'public-xite-siempre-latino':case 'public-sol-musica':{
  if(u.hostname!==root.hostname)return false;
  const account='3722c60a815c199d9c0ef36c5b73da68a62b09d1',key=root.pathname.split('/')[4];
  return ['master','manifest','segment'].some(part=>u.pathname.startsWith('/v1/'+part+'/'+account+'/'+key+'/'))||/^\/(?:240|360|480|540|576|720|1080)p(?:-vtt)?\//.test(u.pathname)||channel.id==='public-sol-musica'&&/^\/sm_\d+\//.test(u.pathname);
 }
 case 'public-enlace':return begins(u,'livecdn.enlace.plus','/enlace/smil:enlace-hd.smil/');
 case 'public-ejtv':return begins(u,'livecdnusa.enlace.plus','/ejtv/smil:ejtv-hd.smil/');
 case 'public-redbull':return path(u,'rbmn-live.akamaized.net',/^\/hls\/live\/590964(?:-b)?\/BoRB-AT\//);
 case 'public-nhk-world':return ['media-tyo.hls.nhkworld.jp','media-osa.hls.nhkworld.jp'].includes(u.hostname)&&(u.pathname.startsWith('/hls/w/live/')||u.pathname.startsWith('/dyseg/map/es/0:w-live-')||/^\/(?:segments|dyseg\/vtt\/posfix)\/[a-zA-Z0-9_-]+\/0_w_\d+\//.test(u.pathname));
 case 'public-bloomberg':return path(u,'www.bloomberg.com',/^\/media-manifest\/streams\/us\.m3u8$/)||begins(u,'liveproduseast.global.ssl.fastly.net','/us/');
 case 'public-pbs-kids':return begins(u,'livestream.pbskids.org','/out/v1/14507d931bbe48a69287e4850e53443c/');
 case 'public-classic-arts':return path(u,'classicarts.akamaized.net',/^\/hls\/live\/1024257(?:-b)?\/CAS\//);
 case 'public-vevo-pop':return path(u,root.hostname,/^\/(?:playlist[^/]*\.(?:m3u8|ts)|(?:ts-[a-z0-9-]+\/)?(?:playlist|beacon)\/amg00056[^/]*\/)/);
 case 'public-nbc-news-now':return path(u,root.hostname,/^\/(?:hls\/master\.m3u8|(?:manifest|segment)\/3fec3e5cac39a52b2132f9c66c83dae043dc17d4\/prod_default_lgchannels-cdp-springserve\/)/)||begins(u,'lgeu-xumoent-nbcnn-hhq2u.fast.nbcuni.com','/live/');
 default:return false;
 }
}
