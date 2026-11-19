// SPDX-License-Identifier: LGPL-2.1-or-later
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {convertWithModule} from '../../cloudflare-worker/src/codec-runtime.mjs';

const binary = readFileSync(new URL('../../cloudflare-worker/src/apple-segment-codec.wasm', import.meta.url));
const module = new WebAssembly.Module(binary);
const root = mkdtempSync(path.join(tmpdir(), 'snap-apple-codec-'));
const run = (program, args) => execFileSync(program, args, {cwd:root, maxBuffer: 16*1024*1024});
const ffmpeg = args => run('ffmpeg', ['-nostdin', '-hide_banner', '-v', 'error', '-xerror', ...args]);
const ffprobe = (args, file) => JSON.parse(run('ffprobe', ['-v','error',...args,'-of','json',file]));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function videoHashes(input) {
  const lines=ffmpeg(['-i',input,'-map','0:v:0','-fps_mode','passthrough','-f','framemd5','pipe:1']).toString().split('\n');
  return lines.filter(line=>/^\d+,/.test(line)).map(line=>line.slice(line.lastIndexOf(',')+1).trim());
}

function editAudioPackets(bytes, select, shiftTicks=()=>0) {
  const copy=Buffer.from(bytes);
  let seen=0, changed=0;
  for(let at=0;at+188<=copy.length;at+=188){
    if(copy[at]!==0x47 || !(copy[at+1]&0x40)) continue;
    const flags=copy[at+3]>>4;
    if(!(flags&1)) continue;
    const end=at+188, pes=at+4+((flags&2)?copy[at+4]+1:0);
    if(pes+10>=end || copy.readUIntBE(pes,3)!==1 || (copy[pes+3]&0xe0)!==0xc0) continue;
    const frame=pes+9+copy[pes+8];
    if(frame+4>end || copy[frame]!==0xff || (copy[frame+1]&0xe0)!==0xe0) continue;
    seen++;
    const shift=shiftTicks(seen);
    if(shift && (copy[pes+7]&0x80)) {
      // PTS in a PES header carries five marker-separated fields on a 33-bit clock.
      const at=pes+9;
      const original=(copy[at]>>1&7)*2**30+copy[at+1]*2**22+(copy[at+2]>>1)*2**15+
                     copy[at+3]*2**7+(copy[at+4]>>1);
      const pts=(original+shift+2**33)%2**33;
      copy[at]=(copy[at]&0xf1)|((Math.floor(pts/2**30)&7)<<1);
      copy[at+1]=Math.floor(pts/2**22)&255;
      copy[at+2]=((Math.floor(pts/2**15)&127)<<1)|1;
      copy[at+3]=Math.floor(pts/2**7)&255;
      copy[at+4]=((pts&127)<<1)|1;
    }
    if(select(seen)) { copy.fill(0,frame,frame+4); changed++; }
  }
  return {bytes:copy,changed};
}

function dropAudioFrames(bytes, drop) {
  const kept=[];
  let audioPid, index=0, dropping=false, removed=0;
  for(let at=0;at+188<=bytes.length;at+=188) {
    const packet=bytes.subarray(at,at+188);
    const pid=((packet[1]&31)<<8)|packet[2], flags=packet[3]>>4;
    if((packet[1]&0x40) && (flags&1)){
      const pes=4+((flags&2)?packet[4]+1:0);
      if(pes+9<188 && packet.readUIntBE(pes,3)===1 && (packet[pes+3]&0xe0)===0xc0) {
        audioPid=pid;
        dropping=drop(++index);
        if(dropping) removed++;
      }
    }
    if(pid!==audioPid || !dropping) kept.push(packet);
  }
  return {bytes:Buffer.concat(kept),removed};
}

try {
  assert.throws(()=>convertWithModule(module,new Uint8Array(4096)), /apple_segment_codec_/);
  assert.throws(()=>convertWithModule(module,new Uint8Array(8*1024*1024+1)), /size/);
  // B-frames, interlaced fields and a real 33-bit timestamp rollover.
  ffmpeg(['-f','lavfi','-i','testsrc2=size=384x216:rate=60000/1001','-f','lavfi','-i','sine=frequency=400:sample_rate=48000',
    '-t','12','-vf','tinterlace=mode=interleave_top','-flags','+ilme+ildct','-c:v','libx264','-x264-params','tff=1',
    '-g','30','-keyint_min','30','-sc_threshold','0','-bf','2','-preset','ultrafast','-c:a','mp2','-b:a','192k','-ac','2',
    '-output_ts_offset','95438','-f','hls','-hls_time','2','-hls_list_size','0','-hls_segment_filename','part%02d.ts','input.m3u8']);
  const files=readdirSync(root).filter(name=>/^part\d+\.ts$/.test(name)).sort();
  assert.ok(files.length>=5);
  let initHash,peakHeap=0;
  const output=[],input=[];
  const times=[];
  for(const [sequence,file] of files.entries()){
    const ts=readFileSync(path.join(root,file));
    times.push(Number(ffprobe(['-show_entries','format=start_time'],file).format.start_time));
    const converted=convertWithModule(module,ts,{sequence,epochMs:1795090000000+2000*sequence});
    peakHeap=Math.max(peakHeap,converted.heapBytes);
    const hash=digest(converted.init);
    if(!initHash){initHash=hash;output.push(converted.init);}
    assert.equal(hash,initHash);
    output.push(converted.media);
    input.push(ts);
  }
  const firstInput=readFileSync(path.join(root,files[0]));
  const damaged=editAudioPackets(firstInput,index=>index===3);
  assert.equal(damaged.changed,1);
  const recovered=convertWithModule(module,damaged.bytes,{epochMs:1795090000000});
  assert.equal(recovered.diagnostics.invalid,1);
  assert.ok(recovered.diagnostics.concealedSamples<=1152);
  for(const shift of [13500,-13500]){
    // Shift the source clock by 150 ms well before a single bad MP2 header.
    // Recovery must use local timing, and the last AAC PTS must follow the source.
    const changed=editAudioPackets(firstInput,index=>index===7,index=>index>=3?shift:0);
    assert.equal(changed.changed,1);
    const result=convertWithModule(module,changed.bytes,{epochMs:1795090000000});
    assert.equal(result.diagnostics.invalid,1);
    assert.ok(result.diagnostics.concealedSamples<=1152);
    if(shift>0) assert.ok(result.diagnostics.insertedSamples>=7200);
    else assert.ok(result.diagnostics.overlapSamples>=7199);
    writeFileSync(path.join(root,'shifted.ts'),changed.bytes);
    writeFileSync(path.join(root,'shifted.mp4'),Buffer.concat([result.init,result.media]));
    function packetSpan(file){
      const packets=ffprobe(['-select_streams','a','-show_entries','packet=pts_time,duration_time'], file).packets;
      return +packets.at(-1).pts_time + +packets.at(-1).duration_time - +packets[0].pts_time;
    }
    assert.ok(Math.abs(packetSpan('shifted.ts')-packetSpan('shifted.mp4'))<1025/48000,
              'AAC must cover the same source clock interval even when a PES timestamp jumps and a header is invalid');
  }
  // Two measured patterns from complete live segments: 2.880 s missing before
  // one corrupt Layer II header, or 3.000 s missing immediately after one.
  ffmpeg(['-f','lavfi','-i','testsrc2=size=192x108:rate=24','-f','lavfi','-i','sine=frequency=400:sample_rate=48000',
    '-t','12','-c:v','libx264','-g','48','-preset','ultrafast','-c:a','mp2','-b:a','192k','-ac','2',
    '-pes_payload_size','1','-f','mpegts','complete.ts']);
  const complete=readFileSync(path.join(root,'complete.ts'));
  for(const [first,count,corrupt] of [[149,120,269],[176,125,175]]){
    const invalid=editAudioPackets(complete,index=>index===corrupt);
    assert.equal(invalid.changed,1);
    const gap=dropAudioFrames(invalid.bytes,index=>index>=first && index<first+count);
    assert.equal(gap.removed,count);
    const repaired=convertWithModule(module,gap.bytes,{epochMs:1795090000000});
    assert.equal(repaired.diagnostics.invalid,1);
    // The TS demuxer can also discard one neighboring partial frame when the
    // transport continuity counter jumps. All missing samples stay on the source clock.
    assert.ok(repaired.diagnostics.insertedSamples>=(count+1)*1152-1);
    assert.ok(repaired.diagnostics.insertedSamples<=(count+2)*1152+1);
    writeFileSync(path.join(root,'repaired.mp4'),Buffer.concat([repaired.init,repaired.media]));
    const decoded=ffmpeg(['-i','repaired.mp4','-map','0:a:0','-ac','1','-c:a','pcm_s16le','-f','s16le','pipe:1']);
    const rms=second=>{
      let squares=0;
      const at=Math.round(second*48000);
      for(let n=0;n<2400;n++) squares+=decoded.readInt16LE((at+n)*2)**2;
      return Math.sqrt(squares/2400);
    };
    assert.ok(rms(2)>100,'sound before hole');
    assert.ok(rms(5)<10,'silent source interval');
    assert.ok(rms(8)>100,'sound returns at original timeline position');
    assert.ok(Math.abs(decoded.length/2/48000-12)<0.035);
    assert.deepEqual(videoHashes('repaired.mp4'),videoHashes('complete.ts'),'all video frames retain their content');
  }
  const excessive=editAudioPackets(firstInput,index=>index>=3);
  assert.ok(excessive.changed>4);
  assert.throws(()=>convertWithModule(module,excessive.bytes,{epochMs:1795090000000}),/apple_segment_codec_/);
  assert.ok(times.some(t=>t<0) && times.some(t=>t>=0),'fixture must cross MPEG-TS wrap');
  writeFileSync(path.join(root,'joined.mp4'),Buffer.concat(output));
  writeFileSync(path.join(root,'source.ts'),Buffer.concat(input));
  const sourceFrames=videoHashes('source.ts');
  assert.ok(sourceFrames.length>=350);
  assert.deepEqual(videoHashes('joined.mp4'),sourceFrames,'all original video frames should decode identically');
  const tracks=ffprobe(['-show_entries','stream=codec_name,sample_rate,channels'], 'joined.mp4').streams;
  assert.equal(tracks[0].codec_name,'h264');
  assert.equal(tracks[1].codec_name,'aac');
  assert.equal(tracks[1].channels,2);
  const audio=ffprobe(['-select_streams','a','-show_entries','packet=dts,duration'], 'joined.mp4').packets;
  assert.ok(audio.length>500);
  for(let i=1;i<audio.length;i++)
    assert.equal(audio[i].dts,audio[i-1].dts+1024,'AAC sample timeline must be contiguous at every fragment boundary');
  ffmpeg(['-i','joined.mp4','-map','0:a:0','-f','null','-']);
  console.log(JSON.stringify({segments:files.length,identicalVideoFrames:sourceFrames.length,continuousAudioPackets:audio.length,peakHeapBytes:peakHeap,moduleSha256:digest(binary)}));
} finally {
  rmSync(root,{recursive:true,force:true});
}
