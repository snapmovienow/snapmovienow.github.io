/* Movi Player 0.4.1, Apache-2.0: https://github.com/MrUjjwalG/movi-player/tree/v0.4.1 */
(()=>{
let loading;
function installCompatibility(Movi){
const prototype=Movi.CanvasRenderer.prototype,draw=prototype.drawFrame;
if(prototype.snapCanvasFallback)return;
prototype.snapCanvasFallback=true;
// Keep presentation working on devices without a WebGL2 context. The SDK's
// presentation queue and subtitle clock are retained; only painting changes.
prototype.drawFrame=function(frame,force=false){
if(this.gl)return draw.call(this,frame,force);
const width=frame.displayWidth||frame.videoWidth,height=frame.displayHeight||frame.videoHeight;
if(!width||!height)return;
const canvas=this.canvas,ctx=canvas.getContext('2d');
if(!ctx)throw new Error('No hay un contexto de imagen compatible.');
this.currentTime=typeof frame.timestamp==='number'?frame.timestamp/1000000:frame.currentTime;
const scale=Math.min(canvas.width/width,canvas.height/height),w=width*scale,h=height*scale;
ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
ctx.drawImage(frame,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
this.snapFramesPainted=(this.snapFramesPainted||0)+1;
this.updateActiveSubtitle();this.renderSubtitles();
};
}
window.ensureMoviePlayer=()=>loading ||= new Promise((resolve,reject)=>{
if(window.Movi){installCompatibility(window.Movi);resolve();return}
const script=document.createElement('script');
script.src='https://cdn.jsdelivr.net/npm/movi-player@0.4.1/dist/element.global.js';
script.crossOrigin='anonymous';script.integrity='sha384-+uCJrAasI6lQnAqDyVp2tQ70nitEFc6n3VETF/Hbyvq2NnEo56tT5p2hg1ZXEJfo';
script.onload=()=>{try{installCompatibility(window.Movi);resolve()}catch(e){loading=null;reject(e)}};
script.onerror=()=>{loading=null;script.remove();reject(new Error('No se pudo cargar el reproductor compatible.'))};
document.head.append(script);
});
window.snapSubtitleTracks=element=>{
const core=element.player,active=core?.trackManager?.getActiveSubtitleTrack()?.id;
return (core?.getSubtitleTracks()||[]).map(t=>({id:t.id,label:t.label||t.language||'',language:t.language||'',kind:'subtitles',mode:t.id===active?'showing':'disabled'}));
};
})();
