import {calculateCapacity} from './capacity-plan.js?v=43.8';

export function mountAdminCapacity({container,document:doc=document}) {
  const section=doc.createElement('section');section.className='wide';section.id='capacityPlanning';
  section.innerHTML=`<h2>Capacidad y coste por espectador</h2>
    <p>Compara un escenario con los cupos del proveedor. El tráfico se estima con la tasa de video que indiques; la calidad 1080p por sí sola no determina esa tasa.</p>
    <p id="capacityInventory" role="status">Inventario pendiente de comprobar.</p>
    <form id="capacityForm" class="capacity-form">
      <label>Espectadores simultáneos<input name="viewers" type="number" min="0" max="100000" step="1" required placeholder="Ej. 10"></label>
      <label>Video por espectador (Mbps)<input name="mbps" type="number" min="0.1" max="100" step="any" required placeholder="Ej. 6"></label>
      <label>Horas al día por espectador<input name="hours" type="number" min="0" max="24" step="any" required placeholder="Ej. 2"></label>
      <label>Días del período<input name="days" type="number" min="1" max="31" step="1" value="30" required></label>
      <label>Coste del proveedor en ese período<input name="providerCost" type="number" min="0" max="1000000000" step="any" placeholder="Importe de factura o presupuesto"></label>
      <label>Coste del alojamiento en ese período<input name="hostingCost" type="number" min="0" max="1000000000" step="any" placeholder="Incluye todos los servicios usados"></label>
      <label>Moneda<select name="currency"><option value="USD">USD</option><option value="MXN">MXN</option><option value="COP">COP</option><option value="EUR">EUR</option></select></label>
      <div class="capacity-actions"><button type="submit">Calcular escenario</button><button type="button" id="capacityExample" class="secondary">Cargar ejemplo</button></div>
    </form>
    <p id="capacityError" role="alert"></p>
    <div id="capacityResults" hidden>
      <dl class="capacity-results" id="capacityNumbers"></dl>
      <p id="capacitySlots" role="status"></p><p id="capacityCost"></p>
      <p>Supone que todos los espectadores del escenario ven las horas indicadas cada día. GB es decimal; puede aumentar por reintentos y otros datos. El coste usa únicamente los dos importes introducidos y no lee tu facturación ni aplica tarifas automáticas. Para comparar escenarios de tráfico, ajusta también el presupuesto del alojamiento si cambia.</p>
      <p>Los cupos disponibles son una referencia del inventario actual. Confirmar señales simultáneas y estabilidad requiere una prueba real de reproducción.</p>
    </div>`;
  container.append(section);
  const $=id=>section.querySelector('#'+id),form=$('capacityForm');let inventory=null,calculated=false;
  const fmt=(value,decimals=2)=>value.toLocaleString('es',{maximumFractionDigits:decimals});
  function inventoryLabel() {
    $('capacityInventory').textContent=inventory?`${fmt(inventory.summary.totalCapacity,0)} cupos totales · ${fmt(inventory.summary.available,0)} asignables ahora. `+
      (inventory.stale?'Inventario sin confirmar; actualízalo en Cuentas del proveedor.': 'Última consulta: '+new Date(inventory.generatedAt).toLocaleString()):'Inventario pendiente de comprobar.';
  }
  function render() {
    const values=Object.fromEntries(new FormData(form));
    try {
      if (!form.checkValidity()) throw Error('Completa el escenario con números dentro de los límites indicados.');
      const result=calculateCapacity({...values,hours:Number(values.hours)*Number(values.days),providerSlots:inventory?.summary.totalCapacity,providerAvailable:inventory?.summary.available});
      $('capacityError').textContent='';$('capacityResults').hidden=false;calculated=true;
      const rows=[['Demanda simultánea estimada',fmt(result.estimatedPeakMbps)+' Mbps'],['Tráfico estimado del período',fmt(result.estimatedTransferGB)+' GB'],['Horas de espectador',fmt(result.viewerHours)],
        ['Coste de servicios indicado',result.costs.total===null?'Sin datos':fmt(result.costs.total)+' '+values.currency],
        ['Coste por espectador en el período',result.costs.perViewer===null?'—':fmt(result.costs.perViewer)+' '+values.currency],
        ['Coste por hora de espectador',result.costs.perViewerHour===null?'—':fmt(result.costs.perViewerHour,4)+' '+values.currency]];
      $('capacityNumbers').replaceChildren();for(const [label,value] of rows){const group=doc.createElement('div'),term=doc.createElement('dt'),amount=doc.createElement('dd');term.textContent=label;amount.textContent=value;group.append(term,amount);$('capacityNumbers').append(group)}
      $('capacitySlots').textContent=!inventory?'Falta comprobar los cupos del proveedor.':inventory.stale?'Cupos pendientes de confirmar. La comparación usa datos guardados.':
        result.missingProviderSlots?`Faltan ${fmt(result.missingProviderSlots,0)} cupos totales para el escenario.`:
        result.missingAvailableSlots?`Los cupos totales cubren el escenario, pero ahora faltan ${fmt(result.missingAvailableSlots,0)} cupos libres.`:'Los cupos asignables actuales cubren el escenario. Falta validar la capacidad de entrega de video.';
      $('capacityCost').textContent=result.costs.total===null?'Introduce ambos costes del mismo período para calcular el coste por espectador. Escribe 0 si ese servicio no tiene coste.':
        !result.viewerHours?'El escenario no contiene horas de espectador; no se calcula un coste por hora.':'Los costes se reparten entre los espectadores y las horas de este escenario; no son una medición de consumo real.';
    } catch(error) {$('capacityError').textContent=error.message.includes(' ') ? error.message : 'Revisa los números del escenario y los costes.';$('capacityResults').hidden=true;}
  }
  form.onsubmit=e=>{e.preventDefault();render()};
  form.oninput=()=>{if(calculated)render()};
  $('capacityExample').onclick=()=>{form.elements.viewers.value='10';form.elements.mbps.value='6';form.elements.hours.value='2';form.elements.days.value='30';form.elements.providerCost.value='';form.elements.hostingCost.value='';render()};
  return {setInventory(snapshot){
    const summary=snapshot?.summary;
    inventory=summary&&Number.isInteger(summary.totalCapacity)&&Number.isInteger(summary.available)&&summary.totalCapacity>=0&&summary.available>=0&&summary.available<=summary.totalCapacity?
      {summary:{totalCapacity:summary.totalCapacity,available:summary.available},stale:!!snapshot.stale||!!snapshot.refreshError,generatedAt:snapshot.generatedAt||Date.now()}:null;
    inventoryLabel();if(calculated)render();
  },clear(){inventory=null;calculated=false;form.reset();$('capacityError').textContent='';$('capacityResults').hidden=true;$('capacityNumbers').replaceChildren();$('capacitySlots').textContent='';$('capacityCost').textContent='';inventoryLabel()}};
}
