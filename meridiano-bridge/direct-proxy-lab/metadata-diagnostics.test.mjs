import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosePlayerMetadata} from '../metadata-diagnostics.mjs';

test('ordinary quality arrays recognize HLS MIME types without returning signed URLs',()=>{
  const result=diagnosePlayerMetadata({qualities:{auto:[{type:'application/x-mpegURL',url:'https://media.dmcdn.net/master?signature=private-fixture'}]}},200);
  assert.equal(result.metadataShape,'player_metadata');assert.equal(result.completed,true);assert.equal(result.hlsQualitiesFound,1);
  assert.equal(result.liveStatus,'unknown');assert.equal(result.liveMediaVerified,false);
  const serialized=JSON.stringify(result);
  assert.ok(!serialized.includes('dmcdn.net')&&!serialized.includes('private-fixture')&&!serialized.includes('https://'));
});
test('an HLS URL extension is recognized when MIME type is missing',()=>{
  const result=diagnosePlayerMetadata({qualities:{auto:[{url:'https://media.dmcdn.net/master.M3U8?signature=fixture'}]}},200);
  assert.equal(result.metadataShape,'player_metadata');assert.equal(result.hlsQualitiesFound,1);assert.equal(result.completed,true);
});
test('a different player error cannot be mistaken for successful metadata or offair',()=>{
  const result=diagnosePlayerMetadata({error:{code:'DM004',message:'fixture URL and account must not be returned'}},200);
  assert.deepEqual(result,{completed:false,metadataShape:'player_error',playerErrorCode:'DM004',liveStatus:'unknown',geoBlocked:false,hlsQualitiesFound:0,liveMediaVerified:false});
});
test('the known geo error is normalized while arbitrary error text is suppressed',()=>{
  assert.equal(diagnosePlayerMetadata({error:{code:'dm007'}},200).geoBlocked,true);
  const result=diagnosePlayerMetadata({error:{code:'https://private.test/secret',message:'private-fixture-password'},password:'private-fixture-password'},200);
  assert.equal(result.metadataShape,'player_error');assert.equal(result.playerErrorCode,null);
  assert.ok(!JSON.stringify(result).includes('private'));
});
test('unknown or malformed response schemas never complete just because HTTP was 200',()=>{
  for(const body of [null,[],{},'ok',{result:'unrecognized'},{qualities:[]},{qualities:{auto:{url:'https://media.test/a.m3u8'}}},{qualities:{auto:['unexpected']}}]){
    const result=diagnosePlayerMetadata(body,200);
    assert.equal(result.metadataShape,'unexpected_json');assert.equal(result.completed,false);assert.equal(result.liveStatus,'unknown');
  }
});
test('zero HLS qualities can coexist with explicit onair and is never inferred as offair',()=>{
  const result=diagnosePlayerMetadata({live_status:'onair',qualities:{auto:[{url:'https://media.test/a.mp4',type:'video/mp4'}]}},200);
  assert.equal(result.completed,true);assert.equal(result.liveStatus,'onair');assert.equal(result.hlsQualitiesFound,0);
  for(const status of ['onair','offair','standby'])assert.equal(diagnosePlayerMetadata({live_status:status},200).liveStatus,status);
  assert.equal(diagnosePlayerMetadata({live_status:'unrecognized'},200).liveStatus,'unknown');
});
test('recognized quality data cannot turn an HTTP error into a completed request',()=>{
  const result=diagnosePlayerMetadata({qualities:{auto:[{url:'https://media.test/a.m3u8'}]}},403);
  assert.equal(result.metadataShape,'player_metadata');assert.equal(result.completed,false);assert.equal(result.liveMediaVerified,false);
});
