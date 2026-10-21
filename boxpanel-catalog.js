// Original BOXPANEL layouts; stable IDs keep existing reseller proposals valid.
// Artwork and sample titles illustrate layouts, not supplied media or APKs.
export const BOXPANEL_DESIGNS=Object.freeze([
 {id:'classic',name:'Órbita TV',description:'Portada panorámica, navegación superior y accesos a tus tres mundos.',layout:'orbit',accent:'#48e2d4',background:'#07151f',wallpaper:'aurora'},
 {id:'cinema',name:'Prisma Cine',description:'Una experiencia de cine con menú lateral, estreno destacado y portadas.',layout:'cinema',accent:'#b69bff',background:'#100d1c',wallpaper:'midnight'},
 {id:'compact',name:'Mosaico TV',description:'Tres grandes accesos visuales y una guía de TV siempre a mano.',layout:'mosaic',accent:'#36b9ff',background:'#071523',wallpaper:'ocean'},
 {id:'aura',name:'Aura',description:'Portada editorial, tarjetas redondeadas y navegación cómoda en el móvil.',layout:'aura',accent:'#ff9dba',background:'#1a111c',wallpaper:'sunset'},
 {id:'panorama',name:'Panorama',description:'El paisaje ocupa la pantalla y el menú flota sobre la imagen.',layout:'panorama',accent:'#d8f686',background:'#101b18',wallpaper:'aurora'},
 {id:'stadium',name:'Arena',description:'TV en directo en primer plano, mosaico de canales y agenda visual.',layout:'arena',accent:'#b3f44f',background:'#0c1714',wallpaper:'ocean'},
 {id:'noir',name:'Noir',description:'Estilo de sala privada: negro, acento dorado y portadas verticales.',layout:'noir',accent:'#edcb83',background:'#141310',wallpaper:'midnight'},
 {id:'horizon',name:'Horizonte',description:'Un escaparate editorial con una gran portada y descubrimientos en mosaico.',layout:'editorial',accent:'#ff9b69',background:'#1b1614',wallpaper:'sunset'}
].map(d=>Object.freeze({...d,version:2})));
