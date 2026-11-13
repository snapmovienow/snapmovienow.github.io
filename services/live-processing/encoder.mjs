import {spawn} from 'node:child_process';
import {mkdir,writeFile,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import {PROFILES} from './policy.mjs';

export async function startEncoder({channel,policy,directory,logoPath,ffmpeg='ffmpeg',threads=2,fps=30,onExit=()=>{}}) {
  if (!path.isAbsolute(directory) || !Number.isInteger(threads) || threads<1 || threads>16 || ![25,30,50,60].includes(fps)) throw Error('invalid_encoder');
  await mkdir(directory,{recursive:true,mode:0o700});
  const textPath=path.join(directory,'watermark.txt');
  await writeFile(textPath,policy.text,{mode:0o600});
  const escapePath=v=>v.replaceAll('\\','\\\\').replaceAll(':','\\:').replaceAll("'","'\\''");
  const args=['-hide_banner','-loglevel','error','-nostdin','-y','-filter_complex_threads','1'];
  if (channel.demo) args.push('-re','-f','lavfi','-i',`testsrc2=size=1280x720:rate=${fps}`,'-re','-f','lavfi','-i','sine=frequency=440:sample_rate=48000');
  else args.push('-rw_timeout','15000000','-protocol_whitelist','http,https,tcp,tls,crypto','-i',channel.source);
  const audio=channel.demo?'1:a:0':'0:a:0?';
  let logoInput;
  if (policy.logo) {
    if (!logoPath || !path.isAbsolute(logoPath)) throw Error('logo_required');
    logoInput=channel.demo?2:1;
    args.push('-loop','1','-framerate','1','-i',logoPath);
  }
  const count=policy.profiles.length;
  let filter='[0:v:0]';
  if (policy.logo) filter+=`[${logoInput}:v:0]overlay=x=W-w-18:y=18:shortest=1,`;
  if (policy.text) filter+=`drawtext=textfile='${escapePath(textPath)}':expansion=none:fontcolor=white:fontsize=24:box=1:boxcolor=black@0.55:boxborderw=8:x=20:y=h-th-20,`;
  filter+=`split=${count}${policy.profiles.map((_,i)=>`[split${i}]`).join('')};`;
  filter+=policy.profiles.map((id,i)=>{const p=PROFILES[id];return `[split${i}]scale=${p.width}:${p.height}:force_original_aspect_ratio=decrease,pad=${p.width}:${p.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}[v${i}]`;}).join(';');
  args.push('-filter_complex',filter);
  for (let i=0;i<count;i++) {
    const p=PROFILES[policy.profiles[i]];
    await mkdir(path.join(directory,String(i)),{mode:0o700});
    args.push('-map',`[v${i}]`,'-map',audio,'-c:v','libx264','-threads',String(threads),'-preset','veryfast','-pix_fmt','yuv420p',
      '-b:v',p.videoKbps+'k','-maxrate',p.videoKbps+'k','-bufsize',p.videoKbps*2+'k','-g',String(fps*2),'-keyint_min',String(fps*2),'-sc_threshold','0',
      '-c:a','aac','-b:a',p.audioKbps+'k','-ar','48000','-ac','2','-f','hls','-hls_time','2','-hls_list_size','6',
      '-hls_flags','delete_segments+independent_segments+temp_file','-hls_delete_threshold','2','-hls_segment_filename',path.join(directory,String(i),'seg%09d.ts'),path.join(directory,String(i),'index.m3u8'));
  }
  const child=spawn(ffmpeg,args,{stdio:['ignore','ignore','pipe']});
  let lastError=false,stopping=false,exited=false,resolveExit;
  const closed=new Promise(r=>{resolveExit=r;});
  // FFmpeg diagnostics can contain source credentials. Never retain or return them.
  child.stderr.on('data',()=>{lastError=true;});
  const finish=(code,reason)=>{if(exited)return;exited=true;onExit({code,reason,stderrSeen:lastError,stopped:stopping});resolveExit();};
  child.once('error',()=>finish(null,'spawn_failed'));
  child.once('exit',code=>finish(code,'encoder_exited'));
  return {
    pid:child.pid,
    get exited(){return exited;},
    async stop(){
      if (!exited) {stopping=true;child.kill('SIGTERM');const killer=setTimeout(()=>child.kill('SIGKILL'),3000);killer.unref();await closed;clearTimeout(killer);}
      await rm(directory,{recursive:true,force:true});
    },
    async mediaReady(){
      if (exited) return false;
      try {for(let i=0;i<count;i++){const names=await readdir(path.join(directory,String(i)));if(!names.includes('index.m3u8')||!names.some(n=>/^seg\d+\.ts$/.test(n)))return false;}return true;}catch{return false;}
    }
  };
}
