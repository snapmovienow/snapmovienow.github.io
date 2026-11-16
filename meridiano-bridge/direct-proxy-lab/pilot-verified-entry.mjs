import {connect} from 'cloudflare:sockets';
import bridge from '../worker.mjs';
import {handlePrivatePilot} from '../private-pilot-handler.mjs';
import {verifiedOriginProof} from './verified-origin-proof.mjs';
export default {fetch(request,env){
  if(request.method==='POST'&&new URL(request.url).pathname==='/health')return handlePrivatePilot(request,env,connect,
    (mode,credentials)=>verifiedOriginProof(mode,credentials,{connect}));
  return bridge.fetch(request,env);
}};
