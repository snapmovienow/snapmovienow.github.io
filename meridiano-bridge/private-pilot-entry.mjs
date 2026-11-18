import {connect} from 'cloudflare:sockets';
import bridge from './worker.mjs';
import {handlePrivatePilot} from './private-pilot-handler.mjs';

export default {fetch(request,env){
  if(request.method==='POST'&&new URL(request.url).pathname==='/health')return handlePrivatePilot(request,env,connect);
  return bridge.fetch(request,env);
}};
