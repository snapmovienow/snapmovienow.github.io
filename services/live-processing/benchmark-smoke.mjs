import assert from 'node:assert/strict';import os from 'node:os';import path from 'node:path';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';import {spawnSync} from 'node:child_process';
import {benchmark} from './benchmark.mjs';
const directory=await mkdtemp(path.join(os.tmpdir(),'snap-benchmark-acceptance-'));
try{
  const sample=path.join(directory,'synthetic.mp4');
  const result=spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=30','-t','10','-c:v','libx264','-threads','2','-preset','ultrafast','-pix_fmt','yuv420p',sample],{encoding:'utf8'});
  assert.equal(result.status,0,'synthetic benchmark input');
  const report=await benchmark({samplePath:sample,levels:[1],seconds:10});
  assert.equal(report.scenarios.length,1);assert.equal(report.scenarios[0].channels,1);assert.equal(report.scenarios[0].concurrentOutputs,2);
  for(const field of ['wallSeconds','slowestEncodingSpeed','cpuCoreEquivalents','availableCpuUsedPercent'])assert(Number.isFinite(report.scenarios[0][field])&&report.scenarios[0][field]>0,field);
  assert.equal(report.productionCapacityCertified,false);
  if(process.env.SNAP_PILOT_BENCHMARK_REPORT){const file=path.resolve(process.env.SNAP_PILOT_BENCHMARK_REPORT);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(report,null,2)+'\n');}
  console.log('PASS: offline measurement records scalar timing/CPU values; no OVH capacity certified.');
}finally{await rm(directory,{recursive:true,force:true});}
