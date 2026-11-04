// Owner-approved title and stable public episode pages. No CDN sessions or media
// signatures belong in the persistent catalog or repository.
export const EMPRESS_SERIES_ID='the-remarried-empress-2026';
export const EMPRESS_SERIES_PAGES=['https://pelisflix200.rest/serie/la-emperatriz-divorciada/','https://tudorama.com/serie/the-remarried-empress/'];
export const isEmpressSeriesPage=value=>EMPRESS_SERIES_PAGES.includes(value instanceof URL?value.href:value);
export const EMPRESS_SERIES_META={id:EMPRESS_SERIES_ID,name:'La emperatriz divorciada (2026)',year:2026,page:EMPRESS_SERIES_PAGES[0],poster:'https://media.themoviedb.org/t/p/w500/9mVhSAIZERTDw7dWbbGuJegCDjl.jpg',plot:'Navier gobierna el Imperio del Este junto a Sovieshu. Cuando su esposo se enamora de Rashta y exige el divorcio, la emperatriz acepta con una condición: poder casarse con Heinrey, príncipe del reino rival. Drama, romance e intrigas de palacio.'};
const plots=[
 'La llegada de Rashta altera la vida de Navier y Sovieshu y provoca las primeras tensiones en la corte.',
 'Mientras Sovieshu toma decisiones que hieren a Navier, la llegada de Heinrey cambia los vínculos de palacio.',
 'La celebración de Año Nuevo intensifica las rivalidades entre Navier, Rashta y el príncipe Heinrey.',
 'La cercanía entre Navier y Heinrey crece mientras Rashta intenta ampliar su influencia en la corte.'
];
const spanish=[2982,3452,3185,3091],subtitled=[3064,3534,3267,3177];
export const EMPRESS_EPISODES=[1,2,3,4].map((number,index)=>({
 id:'empress-2026-s1e'+number+'-es',title:'Episodio '+number,season:1,episode_num:number,page:'https://pelisflix200.rest/episodio/la-emperatriz-divorciada-1x'+number+'/',
 plot:plots[index],poster:'https://tudorama.com/wp-content/uploads/2026/11/La-emperatriz-divorciada-S1x'+number+'-'+(9356+number)+'-episodes.jpg',durationSeconds:spanish[index],
 alternatives:[{id:'empress-2026-s1e'+number+'-subes',title:'Episodio '+number+' · Coreano subtitulado',page:'https://tudorama.com/ver/the-remarried-empress-s1x'+number+'/',durationSeconds:subtitled[index]}]
}));
