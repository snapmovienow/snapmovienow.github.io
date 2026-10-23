// Metadata requests consume no playback slot. Give the preferred account a
// head start, then hedge a slow response against the other authorised accounts.
// A single deadline bounds the whole lookup; abort every losing request.
export function selectCatalogDetail(accounts,read,{hedgeMs=600,timeoutMs=12000}={}){
 return new Promise(resolve=>{
  if(!accounts.length){resolve(null);return}
  let next=0,remaining=accounts.length,finished=false,empty=null;
  const timers=[],controllers=[];
  const finish=value=>{if(finished)return;finished=true;for(const t of timers)clearTimeout(t);for(const c of controllers)c.abort();resolve(value)};
  const launch=()=>{
   if(finished||next>=accounts.length)return;
   const account=accounts[next++],controller=new AbortController();controllers.push(controller);
   Promise.resolve().then(()=>read(account,controller.signal)).then(result=>{
    if(finished||!result)return;
    if(result.empty)empty??=result.data;else if(result.data)finish(result.data);
   }).catch(()=>{}).finally(()=>{
    if(finished)return;
    remaining--;if(next<accounts.length)launch();if(!remaining)finish(empty);
   });
  };
  timers.push(setTimeout(()=>finish(empty),timeoutMs));
  for(let i=1;i<accounts.length;i++)timers.push(setTimeout(launch,i*hedgeMs));
  launch();
 });
}
