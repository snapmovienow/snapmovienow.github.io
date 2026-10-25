// This header crosses only the internal media Durable Object boundary. Strip it
// before a response reaches a viewer; never infer evidence from a requested ext.
export const INITIAL_EVIDENCE_HEADER='X-SMN-Initial-Evidence';
const observations=new WeakMap();
export const validInitialEvidence=value=>['bytes','manifest'].includes(value)?value:null;
export const initialMediaEvidence=response=>observations.get(response)||validInitialEvidence(response?.headers.get(INITIAL_EVIDENCE_HEADER));
export function consumeInitialEvidence(response){
 const evidence=initialMediaEvidence(response),headers=new Headers(response.headers);headers.delete(INITIAL_EVIDENCE_HEADER);
 const clean=new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 if(evidence)observations.set(clean,evidence);return clean;
}
