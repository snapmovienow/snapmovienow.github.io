export const LUIS_ALONSO_ACCOUNT='839b2ee6-efac-45e3-ac2a-26fbcb5f6a2b';
export const isLuisSubpanel=id=>typeof id==='string'&&/^luis-subpanel-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id);

export function verifyManagedPortalTarget(result,unified,query){
 const actor=result.actor,target=result.target;
 const manager=unified&&actor.id===LUIS_ALONSO_ACCOUNT;
 const children=result.managedResellers;
 if(children!==undefined&&(!manager||!Array.isArray(children)||children.some(child=>
  !child||!['ccf-account-3110','ccf-account-3350'].includes(child.id)&&!isLuisSubpanel(child.id)
  ||Object.keys(child).some(key=>!['id','slug','name','status','balance','revision'].includes(key)))))return false;
 if(!target||target.id!==actor.id&&(!manager||query?.slug!==target.slug||!children?.some(child=>child.id===target.id&&child.slug===target.slug)))return false;
 return !result.lines?.some(line=>line.account_id!==target.id)&&!result.ledger?.some(entry=>entry.account_id!==target.id);
}
