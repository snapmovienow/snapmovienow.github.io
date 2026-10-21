export const BOX_ART_SLOTS=Object.freeze(['background','hero','login','tv','movies','series','poster1','poster2','poster3','poster4','poster5']);
const row=(sql,q,...args)=>[...sql.exec(q,...args)][0];
const fail=error=>{throw Object.assign(Error(error),{status:400});};
export function initBoxArtwork(sql){sql.exec('CREATE TABLE IF NOT EXISTS bp_app_artwork (account_id TEXT PRIMARY KEY, config TEXT NOT NULL)');}
export function boxArtwork(sql,accountId){const r=row(sql,'SELECT config FROM bp_app_artwork WHERE account_id=?',accountId);return r?JSON.parse(r.config):{};}
// Resolve only this workspace's saved images. Old approved/draft pixels remain
// immutable even when the independently managed advertising library changes.
export function resolveBoxArtwork(sql,accountId,value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!BOX_ART_SLOTS.includes(k)))fail('box_artwork');
 const old=boxArtwork(sql,accountId),result={};
 for(const [slot,selection] of Object.entries(value)){
  if(!selection||typeof selection!=='object'||typeof selection.imageId!=='string'||!/^[a-f0-9-]{36}$/.test(selection.imageId)||!['cover','contain'].includes(selection.fit)||!Number.isInteger(selection.revision)||selection.revision<1||!BOX_ART_SLOTS.includes(slot))fail('box_artwork');
  if(old[slot]?.imageId===selection.imageId&&old[slot]?.revision===selection.revision){result[slot]={...old[slot],fit:selection.fit};continue;}
  const image=row(sql,'SELECT id,revision,data FROM bp_ads WHERE account_id=? AND id=?',accountId,selection.imageId);
  if(!image||image.revision!==selection.revision)fail('box_artwork');
  result[slot]={imageId:image.id,revision:image.revision,fit:selection.fit,data:image.data};
 }
 return result;
}
export function saveBoxArtwork(sql,accountId,value){sql.exec('INSERT INTO bp_app_artwork(account_id,config) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET config=excluded.config',accountId,JSON.stringify(value));}
