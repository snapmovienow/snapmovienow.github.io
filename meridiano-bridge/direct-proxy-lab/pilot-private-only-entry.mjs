import {connect} from 'cloudflare:sockets';
import {handlePrivatePilot} from '../private-pilot-handler.mjs';
import {verifiedOriginProof} from './verified-origin-proof.mjs';

// Temporary owner diagnostic only. No public relay or playback routes.
export default {fetch(request,env){
  if(request.method!=='POST'||new URL(request.url).pathname!=='/health')
    return Response.json({error:'not_found'},{status:404,headers:{'Cache-Control':'no-store'}});
  return handlePrivatePilot(request,env,connect,
    (mode,credentials)=>verifiedOriginProof(mode,credentials,{connect,timeoutMs:mode==='media'?20000:8000}));
}};
