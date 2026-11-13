import { fxNotices } from './accounting/fx-notices';
import { availableYears, preliminaryTCO, report, type Basis } from './accounting/calculate';
import type { Dataset } from './accounting/schema';
const data: Dataset = JSON.parse(document.querySelector('#dataset')!.textContent!);
const $ = <T extends Element = HTMLElement>(q:string) => document.querySelector<T>(q)!;
const money = (n:number|null, digits=0) => n===null?'—':new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',minimumFractionDigits:digits,maximumFractionDigits:digits}).format(n);
const number = (n:number|null, digits=0) => n===null?'—':new Intl.NumberFormat('en-IE',{maximumFractionDigits:digits}).format(n);
const escape = (s:string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const title = (s:string) => s.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const years = availableYears(data);
for (const y of years) $('#period').insertAdjacentHTML('beforeend',`<option value="${y}">${y}</option>`);
if (!years.length) $('#period').insertAdjacentHTML('beforeend','<option disabled>Annual views appear with dated records</option>');
function render() {
  const id = $<HTMLSelectElement>('#vehicle').value;
  const period = $<HTMLSelectElement>('#period').value;
  const basis = $<HTMLInputElement>('input[name=basis]:checked').value as Basis;
  const r = report(data,id,period==='lifetime'?null:Number(period),basis);
  const d=r.distance, e=r.energy;
  const entries=Object.entries(r.breakdown).sort((a,b)=>b[1]-a[1]);
  const warnings:string[]=[];
  if(!r.hasPurchase) warnings.push('No purchase transaction is recorded. Add an expense with category purchase to the payment year’s event file. Expense totals include known records only.');
  if(!r.v.handover || r.v.initial_state.odometer_km===null) warnings.push('Add the handover date and initial odometer to begin ownership mileage.');
  if(r.unknownPrices) warnings.push(`${r.unknownPrices} charging record(s) have unknown prices. Financial totals are incomplete.`);
  if(d.total===null) warnings.push('Mileage is unavailable: record exact readings at the period boundaries.');
  if(d.invalid) warnings.push('Non-useful mileage exceeds total mileage. Correct the source data before using per-km costs.');
  if(e.missingEnergy) warnings.push(`${e.missingEnergy} recorded charge(s) have no kWh. Energy totals are partial.`);
  if(e.missingPrices && !r.unknownPrices) warnings.push(`${e.missingPrices} charging session(s) in this period have unknown prices.`);
  const notices = fxNotices(r.fxIssues);
  const fxWarnings = notices.filter(notice=>notice.severity==='warning');
  const fxErrors = notices.filter(notice=>notice.severity==='error');
  const metric=(label:string,value:string,detail:string,accent=false)=>`<article class="metric ${accent?'accent':''}"><p>${label}</p><strong>${value}</strong><small>${detail}</small></article>`;
  const line=(label:string,value:string)=>`<div class="detail-line"><span>${label}</span><b>${value}</b></div>`;
  const empty='<div class="empty"><span>＋</span><h3>Your ledger starts here</h3><p>Add actual entries to <code>data/events/YYYY.yaml</code>.<br/>No example expenses are included in your totals.</p></div>';
  $('#dashboard').innerHTML=`
    <section class="vehicle-strip"><div><span class="pill">${r.v.sale?'SOLD':'OWNERSHIP'}</span><h2>${escape(r.v.manufacturer)} ${escape(r.v.model)}</h2><p>${r.year??'Lifetime'} overview <span>·</span> ${basis==='accrual'?'Coverage-based allocation':'Payments by date'}</p></div><div class="vehicle-stats"><span>HANDOVER<strong>${r.v.handover??'Not recorded'}</strong></span><span>MEASURED DISTANCE<strong>${number(d.total)} <small>km</small></strong></span></div></section>
    ${warnings.length?`<details class="notice" open><summary>Data to complete <span>${warnings.length}</span></summary><ul>${warnings.map(w=>`<li>${w}</li>`).join('')}</ul></details>`:''}
    ${fxWarnings.length?`<details class="notice" open><summary>FX warnings · earlier rates used</summary><ul>${fxWarnings.map(issue=>`<li>${escape(issue.message)}</li>`).join('')}</ul></details>`:''}
    ${fxErrors.length?`<section class="notice fx-error" role="alert"><strong>FX errors · totals are incomplete</strong><ul>${fxErrors.map(issue=>`<li>${escape(issue.message)}</li>`).join('')}</ul><p>Add a usable rate in exchange-rates.yaml and rebuild to include these records.</p></section>`:''}
    <section class="metrics" aria-label="Cost summary">
      ${metric('Gross recorded expenses',money(r.gross),'Purchase + acquisition + operating')}
      ${metric('Net vehicle expenses',money(r.netVehicle),'After THG income · before sale')}
      ${metric('Personal net expenses',money(r.netPersonal),'After employer reimbursements · before sale')}
      ${metric('Operating / useful km',money(r.operatingPerUseful,2),'Gross operating costs ÷ useful distance',true)}
    </section>
    <section class="two-columns" id="costs"><article class="panel"><div class="section-heading"><div><p class="eyebrow">WHERE IT GOES</p><h2>Cost breakdown</h2></div><span class="tag">EUR</span></div>
    ${entries.length?`<div class="bars">${entries.map(([category,value])=>`<div class="bar-row"><div><span>${title(category)}</span><strong>${money(value,2)}</strong></div><div class="bar-track"><span style="width:${Math.max(1,value/Math.max(...entries.map(x=>x[1]),1)*100)}%"></span></div></div>`).join('')}</div>`:empty}
    <div class="panel-foot">${line('Vehicle purchase (in period)',money(r.purchaseInPeriod,2))}${line('Acquisition costs (in period)',money(r.acquisition,2))}${line('Operating expenses',money(r.operating,2))}</div></article>
    <article class="panel"><div class="section-heading"><div><p class="eyebrow">THE FULL PICTURE</p><h2>Income & ownership</h2></div></div>
    ${line('THG income',money(r.thg,2))}${line('Employer reimbursements',money(r.reimbursements,2))}${line('Sale receipts (in period)',money(r.saleInPeriod,2))}
    <div class="tco-box"><span>Realized lifetime TCO</span><strong>${money(r.realized)}</strong><p>${r.realized!==null?'Purchase + acquisition + operating − THG − actual sale proceeds. Based on recorded costs.':r.year!==null?'Select Lifetime to view realized TCO.':r.v.sale?'Complete purchase, sale, missing prices and FX rates to calculate realized TCO.':'Available after an actual sale. No depreciation or assumed resale value is included.'}</p>${r.realized!==null?`<small>After employer reimbursements: ${money(r.realizedPersonal,2)} · per useful km: ${money(d.useful&&d.useful>0?r.realized/d.useful:null,2)}</small>`:''}</div>
    ${!r.v.sale?`<details class="simulation"><summary>Explore a preliminary resale scenario</summary><p>Hypothetical lifetime TCO using recorded costs and an assumed sale price. This does not change your accounts or forecast future costs.</p><label for="resale">Assumed resale value <output id="resale-value">${money(0)}</output></label><input id="resale" type="range" min="0" max="${Math.max(100000,(r.purchase??0)*1.2)}" step="100" value="0" ${preliminaryTCO(data,id,0)===null?'disabled':''}/><div class="detail-line"><span>Preliminary TCO</span><b id="preliminary">${money(preliminaryTCO(data,id,0))}</b></div>${r.purchase===null?'<small>Record the purchase transaction and a usable FX rate to enable this scenario.</small>':''}</details>`:''}</article></section>
    <section class="two-columns" id="energy"><article class="panel"><div class="section-heading"><div><p class="eyebrow">DISTANCE THAT COUNTS</p><h2>Mileage</h2></div></div><div class="distance-hero">${number(d.useful)} <span>useful km</span></div>${line('Total measured distance',number(d.total)+' km')}${line('Collection, inspection & service',number(d.excluded)+' km')}${line('Operating / total km',money(r.operatingPerTotal,2))}${line('Operating / useful km',money(r.operatingPerUseful,2))}${line('After THG & reimbursement / useful km',money(r.netOperatingPerUseful,2))}<p class="muted">Reading window: ${d.start??'not recorded'} → ${d.end??'not recorded'}. No trip attribution or estimated odometer readings. Costs cover the selected reporting period; read per-km figures alongside this mileage window.</p></article>
    <article class="panel"><div class="section-heading"><div><p class="eyebrow">ENERGY, WITHOUT GUESSWORK</p><h2>Charging</h2></div><span class="tag">${e.sessions?`${e.sessions-e.missingEnergy}/${e.sessions} with kWh`:'Awaiting data'}</span></div><div class="distance-hero">${number(e.kwh,1)} <span>recorded kWh</span></div>${line('Average price · known price & kWh only',money(e.averagePrice,3)+'/kWh')}${line('Charged energy / 100 total km',number(e.per100,1)+' kWh')}${line('Total km / charged kWh',number(e.kmPerKwh,2)+' km/kWh')}${line('Opening / closing battery inventory',number(e.opening,1)+' / '+number(e.closing,1)+' kWh')}${line('Inventory-adjusted lifetime energy',number(e.adjusted,1)+' kWh')}${line('Adjusted lifetime energy / 100 km',number(e.adjustedPer100,1)+' kWh')}
    <p class="muted">${e.sessions?`Measurement: ${e.measurements.join(', ')||'unknown'}. `:''}${e.excludedCharging?`${e.excludedCharging} charge(s) excluded from all energy calculations because FX is unavailable. `:''}Energy uses charging date (payment date if omitted), independently of accrual. Charger-side readings include losses; mixed or unknown sources are not exact battery consumption. Coverage of unrecorded sessions is unverified. SoC inventory has no monetary value.</p></article></section>
    <section class="panel" id="records"><div class="section-heading"><div><p class="eyebrow">THE SOURCE OF EVERY NUMBER</p><h2>Financial records</h2></div><span class="tag">${r.ledger.length} entries</span></div>${r.ledger.length?`<div class="table-wrap"><table><thead><tr><th>Payment date</th><th>Category</th><th>Original amount</th><th>EUR converted</th><th>In this view</th></tr></thead><tbody>${r.ledger.map(l=>`<tr><td>${l.date}</td><td>${title(l.label)}${l.note?`<span class="transaction-note">${escape(l.note)}</span>`:''}</td><td>${number(l.original,2)} ${l.currency}</td><td>${money(l.eur,2)}</td><td>${money(l.allocated,2)}</td></tr>`).join('')}</tbody></table></div>`:empty}<p class="muted">Purchase is included in these transactions. Sale receipts are stored in vehicles.yaml and shown separately above. Unknown charging prices and amounts excluded for missing FX appear as —, never as free. FX notices above list the affected currencies and payment months.</p></section>
    <details class="panel lifecycle"><summary>Vehicle dates & baseline</summary><div class="lifecycle-grid">${line('First registration',r.v.first_registration??'Not recorded')}${line('Registered to you',r.v.registration??'Not recorded')}${line('Handover',r.v.handover??'Not recorded')}${line('Purchase date',r.purchasedOn??'Not recorded')}${line('Initial odometer',number(r.v.initial_state.odometer_km)+' km')}${line('Initial battery SoC',number(r.v.initial_state.soc_percent)+'%')}${line('Usable battery capacity',number(r.v.battery?.usable_capacity_kwh??null,1)+' kWh')}${line('Sale date',r.v.sale?.date??'Not sold')}</div></details>`;
  const slider=$<HTMLInputElement>('#resale');
  slider?.addEventListener('input',()=>{ $('#resale-value').textContent=money(Number(slider.value)); $('#preliminary').textContent=money(preliminaryTCO(data,id,Number(slider.value))); });
}
$('#vehicle').addEventListener('change',render);
$('#period').addEventListener('change',render);
document.querySelectorAll('input[name=basis]').forEach(input=>input.addEventListener('change',render));
render();
