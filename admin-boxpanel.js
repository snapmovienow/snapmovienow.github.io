import {mountBoxPanel,BOXPANEL_CSS} from './boxpanel-view.js?v=1';
export function mountAdminBoxPanel({api,container}){
 const style=document.createElement('style');style.textContent=BOXPANEL_CSS;document.head.append(style);
 return mountBoxPanel({api,container,owner:true,onClose:()=>document.getElementById('openBoxPanel')?.focus()});
}
