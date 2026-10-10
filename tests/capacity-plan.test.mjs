import assert from 'node:assert/strict';
import {calculateCapacity} from '../capacity-plan.js';

const base={viewers:10,mbps:6,hours:60,providerSlots:36,providerAvailable:33};
let result=calculateCapacity(base);
assert.equal(result.estimatedTransferGB,1620);assert.equal(result.estimatedPeakMbps,60);assert.equal(result.viewerHours,600);
assert.equal(result.missingProviderSlots,0);assert.equal(result.missingAvailableSlots,0);
assert.equal(result.costs.total,null,'unknown bills must not appear as zero cost');assert.equal(result.measured,false);
result=calculateCapacity({...base,providerCost:100,hostingCost:50});
assert.equal(result.costs.total,150);assert.equal(result.costs.perViewer,15);assert.equal(result.costs.perViewerHour,.25);
assert.equal(calculateCapacity({...base,providerCost:100}).costs.total,null,'one bill alone is incomplete');
assert.equal(calculateCapacity({...base,providerCost:'0',hostingCost:0}).costs.total,0,'an explicit zero is known');
result=calculateCapacity({...base,viewers:40});assert.equal(result.missingProviderSlots,4);assert.equal(result.missingAvailableSlots,7);
result=calculateCapacity({...base,viewers:35});assert.equal(result.missingProviderSlots,0);assert.equal(result.missingAvailableSlots,2);
result=calculateCapacity({...base,providerSlots:null,providerAvailable:null});assert.equal(result.missingProviderSlots,null);assert.equal(result.missingAvailableSlots,null);
result=calculateCapacity({...base,viewers:0,providerCost:10,hostingCost:20});assert.equal(result.costs.perViewer,null);assert.equal(result.costs.perViewerHour,null);assert.equal(result.estimatedTransferGB,0);
assert.equal(calculateCapacity({...base,hours:0,providerCost:10,hostingCost:20}).costs.perViewerHour,null);
for(const [key,bad] of [['viewers',''],['viewers',null],['viewers',true],['viewers',.5],['mbps',Infinity],['hours',-1],['hours',745],['providerSlots',3.5],['providerAvailable',37],['providerCost',-1],['hostingCost',' ']])assert.throws(()=>calculateCapacity({...base,[key]:bad}),undefined,key+' must be rejected');
console.log('PASS: capacity traffic units, total/available slots, missing costs, explicit zero and per-viewer arithmetic.');
