// Only inspect a live TS startup that the origin itself labels as a document.
// Preserve mislabeled binary media and cap lookahead even for ambiguous input.
const maxBytes=1024,maxChunks=16;
const decoder=new TextDecoder();
export function liveTsDocumentType(contentType){
 const mime=(contentType||'').split(';',1)[0].trim().toLowerCase();
 if(mime==='text/html'||mime==='application/xhtml+xml')return 'html';
 if(mime==='application/json'||mime==='text/json'||mime.endsWith('+json'))return 'json';
 return null;
}

function classify(prefix,type){
 const text=decoder.decode(prefix).trimStart();
 if(/[\u0000-\u0008\u000e-\u001f]/.test(text))return 'media';
 if(type==='html'){
  const start=text.toLowerCase();
  if(/^<(?:!doctype\s+html|html|head|body)[\s/>]/.test(start))return 'document';
  return ['<!doctype html','<html','<head','<body'].some(tag=>tag.startsWith(start))?'pending':'media';
 }
 if(!text)return 'pending';
 if(text[0]!=='{'&&text[0]!=='[')return 'media';
 try{JSON.parse(text);return 'document'}catch{return 'pending'}
}

export async function checkLiveTsDocument(first,read,type){
 const chunks=[first],prefix=new Uint8Array(maxBytes);
 let size=0;
 for(;;){
  const chunk=chunks[chunks.length-1];
  const used=Math.min(maxBytes-size,chunk.length);
  prefix.set(chunk.subarray(0,used),size);size+=used;
  const kind=classify(prefix.subarray(0,size),type);
  if(kind==='document')throw Error('invalid_live_media');
  if(kind==='media'||size===maxBytes||chunks.length===maxChunks)return chunks;
  const next=await read();
  if(next.done)return chunks;
  chunks.push(next.value);
 }
}
