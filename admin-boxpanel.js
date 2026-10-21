import {mountBoxPanel,BOXPANEL_CSS} from './boxpanel-view.js?v=2';
import {mountBoxPanelApps,BOXAPP_CSS} from './boxpanel-apps.js?v=2';
export function mountAdminBoxPanel({api,container}){
 const style=document.createElement('style');style.textContent=BOXPANEL_CSS+BOXAPP_CSS;document.head.append(style);
 return mountBoxPanel({api,container,owner:true,apps:mountBoxPanelApps,onClose:()=>document.getElementById('openBoxPanel')?.focus()});
}
