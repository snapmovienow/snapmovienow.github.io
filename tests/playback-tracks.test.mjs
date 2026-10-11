import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
class Target extends EventTarget{constructor(){super();this.style={}}fire(event){this.dispatchEvent(new Event(event))}}
class Select extends Target{
 constructor(){super();this.options=[];this.value=''}
 replaceChildren(){this.options=[];this.value=''}
 add(option){this.options.push(option);if(option.selected||this.options.length===1)this.value=option.value}
}
class Option{constructor(text,value){this.text=text;this.value=value;this.selected=false}}
const runtime=vm.createContext({Option,snapSubtitleTracks:video=>{assert.equal(video,movie,'native captions must use TextTrackList directly');return video.textTracks}});
vm.runInContext(readFileSync(new URL('../playback-tracks.js',import.meta.url),'utf8'),runtime);
const movie=new Target(),native=new Target();movie.currentSrc=native.currentSrc='synthetic-video';
movie.audioTracks=[{language:'eng',enabled:true},{language:'spa',enabled:false}];
movie.textTracks=[{id:18,kind:'subtitles',language:'es',mode:'disabled'}];
const selections=[];movie.player={selectSubtitleTrack:async id=>{selections.push(id);movie.textTracks[0].mode=id===18?'showing':'disabled';return true}};
native.audioTracks=[{language:'es',enabled:true}];native.textTracks=[{kind:'metadata',mode:'hidden'},{kind:'captions',language:'en',mode:'disabled'}];
let player=movie,engine=null;const preferences={audio:'es',subtitle:'off'},saved=[];
const audioSelect=new Select(),subtitleSelect=new Select(),status={};
const controls=runtime.SMNPlaybackTracks.create({players:[movie,native],nativePlayer:native,getPlayer:()=>player,getEngine:()=>engine,getPreferences:()=>preferences,
 onPreference:(name,value)=>{preferences[name]=value;saved.push({name,value})},audioSelect,subtitleSelect,status});
controls.sync();assert.equal(movie.audioTracks[1].enabled,true);assert.equal(audioSelect.value,'1');assert.equal(selections[0],null);
subtitleSelect.value='0';subtitleSelect.fire('change');await Promise.resolve();assert.equal(selections.at(-1),18);assert.equal(preferences.subtitle,'es');
audioSelect.value='0';audioSelect.fire('change');assert.equal(preferences.audio,'en');assert.equal(movie.audioTracks[0].enabled,true);

// A different transport resets automatic preferences without losing the
// user's language choice, and HLS changes are written to the engine indices.
engine={audioTracks:[{lang:'spa'},{lang:'eng'}],subtitleTracks:[{lang:'es'},{lang:'en'}],audioTrack:0,subtitleTrack:-1};
controls.reset();controls.sync();assert.equal(engine.audioTrack,1);assert.equal(engine.subtitleTrack,0);
subtitleSelect.value='off';subtitleSelect.fire('change');assert.equal(engine.subtitleTrack,-1);assert.equal(preferences.subtitle,'off');
audioSelect.value='0';audioSelect.fire('change');assert.equal(engine.audioTrack,0);assert.equal(preferences.audio,'es');

// Inactive player's events must not rewrite active controls. Native captions
// retain their original indices when unrelated metadata tracks are skipped.
player=native;engine=null;controls.reset();native.fire('loadedmetadata');assert.equal(audioSelect.disabled,true);
assert.equal(subtitleSelect.options.length,2);assert.equal(subtitleSelect.options[1].value,'1');
subtitleSelect.value='1';subtitleSelect.fire('change');assert.equal(native.textTracks[1].mode,'showing');assert.equal(preferences.subtitle,'en');
status.textContent='active-native';movie.fire('emptied');assert.equal(status.textContent,'active-native');
controls.destroy();native.fire('loadedmetadata');assert.equal(status.textContent,'active-native');
assert(saved.length>=5);
console.log('PASS: movie/HLS/native language preferences, subtitle disabling, caption indices and inactive-player event isolation.');
