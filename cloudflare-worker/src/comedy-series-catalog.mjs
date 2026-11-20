// This catalogue is deliberately finite. Source adapters cannot add shows or
// change the stable catalogue identity through a remote response.
export const COMEDY_SERIES_SERVER='smn-comedy-series';
export const COMEDY_SERIES_DEFINITIONS=Object.freeze([
 Object.freeze({id:'comedy-muertos-sl',upstreamId:'1',name:'Muertos S.L.',aliases:Object.freeze(['Muertos SL','Muertos S. L.','Death Inc.']),year:2024,seasons:Object.freeze({'1':8,'2':6,'3':6,'4':6}),sourcePage:'https://ww3.gnulahd.nu/ver/muertos-s-l/'}),
 Object.freeze({id:'comedy-machos-alfa',upstreamId:'2',name:'Machos alfa',aliases:Object.freeze(['Alpha Males']),year:2022,seasons:Object.freeze({'1':10,'2':10,'3':10,'4':6,'5':6}),sourcePage:'https://pelisflix200.date/serie/machos-alfa-zhmk/'}),
 Object.freeze({id:'comedy-cunados',upstreamId:'3',name:'Cuñados',aliases:Object.freeze([]),year:2012,seasons:Object.freeze({'1':9}),sourcePage:'https://www.mediasetinfinity.es/series-online/cunados/'})
]);
export function comedyUsageRoot(row){
 return row?.type==='series'&&COMEDY_SERIES_DEFINITIONS.some(def=>def.id===row.id)?{rootServer:COMEDY_SERIES_SERVER,rootSeriesId:row.id}:{};
}
