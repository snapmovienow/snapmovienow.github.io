import {handleXtream} from './xtream.mjs';
import {createAdultPolicy} from './content-permissions.mjs';
import {countSeriesEpisodes as count} from './xtream-series.mjs';
const normal=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

// Administrator-only inspection of the same public series formatter and user
// permissions. Return counts/statuses, never playback URLs or provider secrets.
export async function diagnoseSeries(deps,{query,username},origin){
  if(typeof query!=='string'||query.trim().length<3||query.length>120||typeof username!=='string'||username.length>80)return deps.json({error:'invalid_series_check'},400);
  const user=deps.users.find(item=>normal(item.username)===normal(username));
  if(!user)return deps.json({error:'user_not_found'},404);
  if(user.status!=='active'||user.expiresAt&&user.expiresAt<=Date.now())return deps.json({error:'account_inactive'},403);
  if(!user.permissions.series)return deps.json({error:'content_disabled'},403);
  const rows=await deps.catalog('get_series');
  const matches=rows.filter(row=>normal(row.name).includes(normal(query))).slice(0,2);
  if(!matches.length)return deps.json({checkedAt:new Date().toISOString(),results:[],state:'not_found'});
  const results=[];
  for(const row of matches){
    const ids=await deps.register([{kind:'series_list',server:row._server,upstreamId:String(row.series_id),ext:'mp4'}]);
    let upstream=null;
    const catalog=async(action,server,params)=>{const data=await deps.catalog(action,server,params,{fresh:true});if(action==='get_series_info')upstream=data;return data};
    const target=new URL('/player_api.php',origin);
    target.search=new URLSearchParams({username:user.username,password:'diagnostic-only',action:'get_series_info',series_id:String(ids[0])});
    try{
      const response=await handleXtream(new Request(target),{
        ...deps,catalog,adultPolicy:createAdultPolicy(catalog),
        authenticate:async()=>({user,username:user.username,session:{}}),
        play:async()=>{throw Error('diagnostics never start playback')}
      });
      const data=await response.json();
      results.push({name:row.name,publicId:ids[0],httpStatus:response.status,
        state:response.ok?(count(data)?'ready':'no_episodes'):data.error==='adult_content_disabled'?'adult_content_disabled':'unavailable',
        upstreamEpisodes:upstream?count(upstream):null,
        episodes:response.ok?count(data):0,
        seasons:response.ok?data.seasons.map(season=>({number:season.season_number,episodes:data.episodes[season.season_number]?.length||0})):[]});
    }catch{results.push({name:row.name,publicId:ids[0],httpStatus:502,state:'upstream_unavailable',episodes:0,seasons:[]})}
  }
  return deps.json({checkedAt:new Date().toISOString(),results});
}
