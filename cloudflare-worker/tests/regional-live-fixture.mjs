import {REGIONAL_CHANNELS} from '../src/official-live.mjs';
const hls=text=>new Response(text,{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
const stamp='1111111111111111111111111111111111111111',session='11111111-1111-1111-1111-111111111111';
export function regionalFixture(value,options={}){
 const u=new URL(typeof value==='object'&&value?.url?value.url:value),page=REGIONAL_CHANNELS.find(c=>c.page===u.href);
 if(page){
  if(page.adapter==='nbcu-fast')return new Response(JSON.stringify({video_is_fast:'1',m3u8_url:'https://d2kowtvrzzi7ps.cloudfront.net/11602/'+page.streamId+'/hls/master.m3u8?ads.caid=fixture&ads.xumo_ifa=IFA'}).replaceAll('"','&quot;'));
  if(page.adapter==='cbs-local')return new Response(JSON.stringify({video:'https://dai.google.com/linear/hls/event/'+page.event+'/master.m3u8',previewUrl:'https://not-the-ad-stitched-player.example.test/live.m3u8'}));
  return null;
 }
 if(u.hostname==='d2kowtvrzzi7ps.cloudfront.net'){
  const c=REGIONAL_CHANNELS.find(c=>c.streamId&&u.pathname.includes('/'+c.streamId+'/'))||REGIONAL_CHANNELS.find(c=>c.streamId&&u.pathname.endsWith('/'+c.streamId+'.m3u8'));
  if(!c)return null;
  return u.pathname.endsWith('master.m3u8')?hls('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=600000\n/manifest/'+stamp+'/prod_default_nbc/'+session+'/'+c.streamId+'.m3u8\n'):hls('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MAP:URI="https://'+c.mediaHost+'/live/init.mp4"\n#EXTINF:4,\nhttps://'+c.mediaHost+'/live/video.ts\n');
 }
 if(u.hostname==='dai.google.com'){
  const c=REGIONAL_CHANNELS.find(c=>c.event&&u.pathname.includes(c.event));if(!c)return null;
  if(u.pathname.endsWith('master.m3u8'))return new Response(null,{status:302,headers:{Location:'https://dai.google.com/linear/hls/pa/event/'+c.event+'/stream/'+session+'/variant.m3u8'}});
  if(u.pathname.endsWith('.m3u8'))return hls('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nhttps://dai.google.com/linear/pods/v1/p/'+c.event+'/'+session+'/pod/1.ts\n#EXTINF:4,\nhttps://'+c.mediaHost+'/live/program.ts\n');
  return new Response(new Uint8Array(2048).fill(0x47),{headers:{'Content-Type':'video/mp2t'}});
 }
 const c=REGIONAL_CHANNELS.find(c=>c.mediaHost===u.hostname);if(!c)return null;
 return new Response(new Uint8Array(2048).fill(0x47),{headers:{'Content-Type':u.pathname.endsWith('.mp4')?'video/mp4':'video/mp2t'}});
}
