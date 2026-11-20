export function isComedyTransportStream(bytes){
 return bytes instanceof Uint8Array&&bytes.length>=565&&bytes[0]===0x47&&bytes[188]===0x47&&bytes[376]===0x47&&bytes[564]===0x47;
}

// A few public HLS hosts disguise MPEG-TS as a font or return an HTML error
// with video/mp2t. Validate the bytes before exposing the resource to a player.
// Rebuild the stream with the untouched prefix so a successful probe loses none.
export async function checkedComedySegment(response){
 const reader=response.body?.getReader();
 if(!reader)throw Error('media_empty');
 const chunks=[];let length=0;
 try{
  while(length<565){const part=await reader.read();if(part.done)break;chunks.push(part.value);length+=part.value.length;}
  const prefix=new Uint8Array(Math.min(565,length));let offset=0;
  for(const chunk of chunks){const part=chunk.subarray(0,prefix.length-offset);prefix.set(part,offset);offset+=part.length;if(offset===prefix.length)break;}
  if(!isComedyTransportStream(prefix))throw Error('media_not_video');
 }catch(error){await reader.cancel().catch(()=>{});reader.releaseLock();throw error;}
 let pending=chunks;
 const body=new ReadableStream({
  async pull(controller){
   if(pending){for(const chunk of pending)controller.enqueue(chunk);pending=null;return;}
   try{const part=await reader.read();if(part.done){reader.releaseLock();controller.close();}else controller.enqueue(part.value);}
   catch(error){reader.releaseLock();controller.error(error);}
  },
  async cancel(reason){await reader.cancel(reason).catch(()=>{});reader.releaseLock();}
 });
 const headers=new Headers(response.headers);headers.set('Content-Type','video/mp2t');
 return new Response(body,{status:response.status,headers});
}
