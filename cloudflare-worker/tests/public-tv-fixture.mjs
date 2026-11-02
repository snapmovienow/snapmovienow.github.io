import {PUBLIC_TV_CHANNELS} from '../src/public-tv-channels.mjs';
const hls=text=>new Response(text,{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
export function publicTvFixtureUrls(c){
 const root=new URL(c.page);let variant=new URL('fixture.m3u8',root).href,media=new URL('fixture.ts',root).href;
 if(c.id==='public-rtve-24h'){variant='https://rtvelivestream.rtve.es/rtvesec/24h/fixture.m3u8';media=new URL('fixture.ts',variant).href;}
 if(['public-adn40','public-milenio'].includes(c.id)){const id=root.pathname.split('/').at(-1).replace('.m3u8','');variant='https://us-b4-p-e-fixture.cdn.mdstrm.com/live-stream/'+id+'/fixture.m3u8';media=new URL('fixture.ts',variant).href;}
 if(['public-xite-nuevo-latino','public-xite-siempre-latino','public-sol-musica'].includes(c.id)){variant=root.origin+root.pathname.replace('/master/','/manifest/').replace(/\/[^/]+$/, '/fixture/0.m3u8');media=root.origin+(c.id==='public-sol-musica'?'/sm_720/fixture.ts':'/720p-vtt/fixture.ts');}
 if(c.id==='public-nhk-world'){variant='https://media-tyo.hls.nhkworld.jp/hls/w/live/fixture.m3u8';media='https://media-tyo.hls.nhkworld.jp/segments/1_v3/0_w_3/fixture.mp4';}
 if(c.id==='public-bloomberg'){variant='https://liveproduseast.global.ssl.fastly.net/us/fixture.m3u8';media=new URL('fixture.ts',variant).href;}
 if(c.id==='public-vevo-pop'){variant=root.origin+'/playlist1280x720p.m3u8';media=root.origin+'/playlist1280x720p_1.ts';}
 if(c.id==='public-nbc-news-now'){variant=root.origin+'/manifest/3fec3e5cac39a52b2132f9c66c83dae043dc17d4/prod_default_lgchannels-cdp-springserve/fixture/0.m3u8';media='https://lgeu-xumoent-nbcnn-hhq2u.fast.nbcuni.com/live/fixture.ts';}
 return {variant,media,init:new URL(c.id==='public-vevo-pop'?'playlistinit.ts':'init.mp4',media).href,audio:new URL(c.id==='public-vevo-pop'?'playlistaudio.m3u8':'audio.m3u8',variant).href};
}
export function publicTvFixture(value){
 const url=typeof value==='object'?value.url:value;
 for(const c of PUBLIC_TV_CHANNELS){
  const {variant,media,init,audio}=publicTvFixtureUrls(c);
  if(url===c.page)return hls('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Original",URI="'+audio+'"\n#EXT-X-STREAM-INF:BANDWIDTH=600000,AUDIO="audio"\n'+variant+'\n');
  if(url===variant||url===audio)return hls('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MAP:URI="'+init+'"\n#EXTINF:6,\n'+media+'\n');
  if(url===media||url===init)return new Response(new Uint8Array(2048).fill(0x47),{headers:{'Content-Type':url.endsWith('.mp4')?'video/mp4':'video/mp2t'}});
 }
 return null;
}
