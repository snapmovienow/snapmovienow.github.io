import {connect} from 'cloudflare:sockets';
import {subtls} from 'workers-fetch-proxy/subtls';
import roots from './origin-roots.pem';
import bridge from '../worker.mjs';
import {handlePrivatePilot} from '../private-pilot-handler.mjs';
import {privateOriginProof} from '../private-origin-proof.mjs';

export default {fetch(request,env){
  if(request.method==='POST'&&new URL(request.url).pathname==='/health'){
    const originProof=(mode,credentials)=>privateOriginProof(mode,credentials,{connect,upgradeTls:subtls({rootCertificates:roots})});
    return handlePrivatePilot(request,env,connect,originProof);
  }
  return bridge.fetch(request,env);
}};
