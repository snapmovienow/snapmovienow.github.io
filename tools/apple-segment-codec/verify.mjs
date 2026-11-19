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

function damageAudioPacket(bytes, select) {
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
    if(select(++seen)) { copy.fill(0,frame,frame+4); changed++; }
  }
  return {bytes:copy,changed};
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
  const damaged=damageAudioPacket(firstInput,index=>index===3);
  assert.equal(damaged.changed,1);
  const recovered=convertWithModule(module,damaged.bytes,{epochMs:1795090000000});
  assert.equal(recovered.diagnostics.invalid,1);
  assert.ok(recovered.diagnostics.concealedSamples<=1152);
  const excessive=damageAudioPacket(firstInput,index=>index>=3);
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
