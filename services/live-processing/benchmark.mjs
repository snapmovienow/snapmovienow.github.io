// Run on the exact proposed server with a representative LOCAL sample.
// No provider credentials, live source requests, spectators or purchases.
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';import {spawnSync} from 'node:child_process';
import {startEncoder} from './encoder.mjs';import {DEFAULT_POLICY} from './policy.mjs';
const option=name=>{const at=process.argv.indexOf('--'+name);return at<0?null:process.argv[at+1];};
export async function benchmark({samplePath,logoPath=null,levels=[1,3,5],seconds=30,threads=2,fps=30,deadlineMs=180000}={}){
  if(!path.isAbsolute(samplePath||'')||logoPath&&!path.isAbsolute(logoPath)||!Array.isArray(levels)||!levels.length||levels.length>4||levels.some(n=>!Number.isInteger(n)||n<1||n>20)||!Number.isInteger(seconds)||seconds<10||seconds>300||!Number.isInteger(deadlineMs)||deadlineMs<1000||deadlineMs>600000)throw Error('invalid_benchmark');
  const probe=spawnSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',samplePath],{encoding:'utf8',maxBuffer:1024*1024});
  if(probe.status!==0)throw Error('sample_unreadable');
  const metadata=JSON.parse(probe.stdout),video=metadata.streams.find(s=>s.codec_type==='video'),duration=Number(metadata.format.duration);
  if(!video||!Number.isFinite(duration)||duration<seconds)throw Error('sample_too_short');
  const optional=async name=>{try{return(await readFile(name,'utf8')).trim();}catch{return null;}};
  const cpuMax=await optional('/sys/fs/cgroup/cpu.max'),cpuValues=cpuMax?.split(/\s+/),quota=cpuValues?.[0]!=='max'?Number(cpuValues?.[0])/Number(cpuValues?.[1]):null;
  const availableCpu=Number.isFinite(quota)&&quota>0?Math.min(os.availableParallelism(),quota):os.availableParallelism();
  const report={at:new Date().toISOString(),scope:'offline local-file encoding only; does not certify network, 24/7 stability or exact-server equivalence',host:{cpu:os.cpus()[0]?.model,availableCpu,visibleCpu:os.availableParallelism(),cpuMax,memoryMax:await optional('/sys/fs/cgroup/memory.max')},input:{width:video.width,height:video.height,frameRate:video.avg_frame_rate,video:video.codec_name,seconds},outputs:['480p','720p'],logo:!!logoPath,fps,threadsPerOutput:threads,scenarios:[],productionCapacityCertified:false};
  const temporary=await mkdtemp(path.join(os.tmpdir(),'snap-encode-benchmark-'));
  try{
    for(const count of levels){
      const jobs=[];const begin=performance.now();let timer;
      try{
        const completed=[];
        for(let i=0;i<count;i++){
          const done={measurement:null,exit:null};let resolve;const finished=new Promise(r=>{resolve=r;});
          const job=await startEncoder({channel:{id:'local-'+i},policy:{...DEFAULT_POLICY,logo:!!logoPath},directory:path.join(temporary,String(i)),samplePath,logoPath,seconds,threads,fps,onMeasure:value=>{done.measurement=value;},onExit:value=>{done.exit=value;resolve();}});
          jobs.push(job);completed.push({done,finished});
        }
        await Promise.race([Promise.all(completed.map(r=>r.finished)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('benchmark_deadline')),deadlineMs);})]);clearTimeout(timer);
        if(completed.some(r=>r.done.exit.code!==0||!r.done.measurement))throw Error('encoding_failed');
        const wallSeconds=(performance.now()-begin)/1000,speeds=completed.map(r=>seconds/r.done.measurement.wallSeconds),cpuSeconds=completed.reduce((n,r)=>n+r.done.measurement.cpuUserSeconds+r.done.measurement.cpuSystemSeconds,0);
        report.scenarios.push({channels:count,concurrentOutputs:count*2,wallSeconds:Number(wallSeconds.toFixed(3)),slowestEncodingSpeed:Number(Math.min(...speeds).toFixed(3)),cpuCoreEquivalents:Number((cpuSeconds/wallSeconds).toFixed(3)),availableCpuUsedPercent:Number((cpuSeconds/wallSeconds/availableCpu*100).toFixed(1)),realtimeWith25PercentSpeedMargin:speeds.every(n=>n>=1.25)});
      }finally{clearTimeout(timer);await Promise.all(jobs.map(job=>job.stop()));}
    }
  }finally{await rm(temporary,{recursive:true,force:true});}
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const sample=option('input'),logo=option('logo'),output=option('report');
  if(!sample||!output)throw Error('Usage: node benchmark.mjs --input /absolute/sample.mp4 --report /absolute/report.json [--logo /absolute/logo.png] [--levels 1,3,5] [--seconds 30] [--fps 30]');
  const report=await benchmark({samplePath:path.resolve(sample),logoPath:logo?path.resolve(logo):null,levels:(option('levels')||'1,3,5').split(',').map(Number),seconds:Number(option('seconds')||30),fps:Number(option('fps')||30)});
  const file=path.resolve(output);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
