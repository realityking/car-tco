import { acquisitionCategories } from './categories';
import type { Dataset, Event, Rates, Vehicle } from './schema';

const day = 86_400_000;
const timestamp = (s: string) => Date.parse(s + 'T00:00:00Z');
export const ratio = (n: number, d: number | null): number | null => d !== null && d > 0 ? n/d : null;
export function toEUR(amount: number, currency: string, paymentDate: string, rates: Rates): number {
  if (currency === 'EUR' || amount === 0) return amount;
  const rate = rates[paymentDate.slice(0,7)]?.[currency];
  if (!rate) throw new Error(`Missing FX rate: ${currency}, ${paymentDate.slice(0,7)}`);
  // Rates are units of foreign currency per one EUR.
  return amount / rate;
}
export type Basis = 'cash' | 'accrual';
export function annualShare(e: {date:string; coverage?: {start:string; end:string}}, year: number | null, basis: Basis): number {
  if (year === null) return 1;
  if (basis === 'cash' || !e.coverage) return +e.date.startsWith(String(year) + '-');
  const start = timestamp(e.coverage.start), end = timestamp(e.coverage.end) + day;
  const overlap = Math.max(0, Math.min(end, timestamp(`${year+1}-01-01`)) - Math.max(start, timestamp(`${year}-01-01`)));
  return overlap / (end-start);
}
export function mileage(v: Vehicle, events: Event[], year: number | null) {
  const points = events.filter((e): e is Extract<Event, {type:'odometer'}> => e.vehicle === v.id && e.type === 'odometer').map(e => ({date:e.date, km:e.odometer_km}));
  if (v.handover && v.initial_state.odometer_km !== null) points.push({date:v.handover, km:v.initial_state.odometer_km});
  if (v.sale?.odometer_km != null) points.push({date:v.sale.date, km:v.sale.odometer_km});
  points.sort((a,b) => a.date.localeCompare(b.date));
  const latest = points.at(-1);
  const start = year === null ? v.handover : (v.handover && v.handover > `${year}-01-01` ? v.handover : `${year}-01-01`);
  const end = year === null ? (v.sale?.date ?? latest?.date) : [v.sale?.date, latest?.date, `${year+1}-01-01`].filter((d):d is string => !!d).sort()[0];
  const first = points.find(p => p.date === start), last = points.find(p => p.date === end);
  const total = first && last && end && start && end >= start ? last.km - first.km : null;
  const excluded = events.filter(e => e.vehicle === v.id && e.type === 'non_useful_mileage' && start && end && e.date >= start && e.date <= end && (year === null || e.date.startsWith(`${year}-`))).reduce((s,e) => s + (e.type === 'non_useful_mileage' ? e.km : 0),0);
  const useful = total === null || excluded > total ? null : total - excluded;
  return {total, excluded, useful, start, end: end ?? null, invalid: total !== null && excluded > total};
}
export function report(data: Dataset, vehicleId: string, year: number | null = null, basis: Basis = 'accrual') {
  const v = data.vehicles.find(v => v.id === vehicleId);
  if (!v) throw new Error('Unknown vehicle');
  const events = data.events.filter(e => e.vehicle === vehicleId);
  const breakdown: Record<string,number> = {};
  let operating=0, acquisition=0, thg=0, reimbursements=0, unknownPrices=0;
  const ledger: {date:string; label:string; original:number|null; currency:string; eur:number|null; allocated:number|null}[] = [];
  for (const e of events) {
    if (e.type !== 'expense' && e.type !== 'income') continue;
    const share = annualShare(e,year,basis);
    if (!share) continue;
    const eur = e.amount === null ? null : toEUR(e.amount,e.currency,e.date,data.rates);
    ledger.push({date:e.date,label:e.category,original:e.amount,currency:e.currency,eur,allocated:eur === null ? null : eur*share});
    if (eur === null) { unknownPrices++; continue; }
    const amount = eur*share;
    if (e.type === 'income') { if (e.category === 'thg') thg+=amount; else reimbursements+=amount; }
    else {
      breakdown[e.category]=(breakdown[e.category]??0)+amount;
      if (acquisitionCategories.includes(e.category)) acquisition+=amount; else operating+=amount;
    }
  }
  const purchaseDate = v.purchase.payment_date ?? v.purchase.date;
  const purchase = v.purchase.amount !== null && purchaseDate ? toEUR(v.purchase.amount,v.purchase.currency,purchaseDate,data.rates) : null;
  const purchaseInPeriod = purchaseDate && (year === null || purchaseDate.startsWith(`${year}-`)) ? purchase : 0;
  const saleDate = v.sale?.payment_date ?? v.sale?.date;
  const sale = v.sale && v.sale.amount !== null && saleDate ? toEUR(v.sale.amount,v.sale.currency,saleDate,data.rates) : null;
  const saleInPeriod = saleDate && (year === null || saleDate.startsWith(`${year}-`)) ? sale : 0;
  const distance = mileage(v,events,year);
  const gross = operating+acquisition+(purchaseInPeriod??0);
  const netVehicle = gross-thg;
  const netPersonal = netVehicle-reimbursements;
  const realized = year === null && v.sale && purchase !== null && sale !== null && !unknownPrices ? netVehicle-sale : null;
  const charging = events.filter((e): e is Extract<Event,{type:'expense'}> => e.type === 'expense' && e.category === 'charging' && (year === null || (e.occurred_on ?? e.date).startsWith(`${year}-`)));
  const withEnergy = charging.filter(e => e.energy_kwh !== undefined);
  const energy = withEnergy.reduce((s,e) => s+(e.energy_kwh??0),0);
  const pricedEnergy = withEnergy.filter(e => e.amount !== null);
  const pricedKwh = pricedEnergy.reduce((s,e) => s+(e.energy_kwh??0),0);
  const pricedCost = pricedEnergy.reduce((s,e) => s+toEUR(e.amount!,e.currency,e.date,data.rates),0);
  const measurements = [...new Set(withEnergy.map(e => e.measurement ?? 'unknown'))];
  const missingEnergy = charging.length-withEnergy.length;
  const opening = v.battery?.usable_capacity_kwh != null && v.initial_state.soc_percent !== null ? v.battery.usable_capacity_kwh*v.initial_state.soc_percent/100 : null;
  const closing = v.battery?.usable_capacity_kwh != null && v.sale?.soc_percent != null ? v.battery.usable_capacity_kwh*v.sale.soc_percent/100 : null;
  const adjusted = year === null && v.sale && opening !== null && closing !== null && !missingEnergy && energy+opening-closing >= 0 ? energy+opening-closing : null;
  return {v,year,basis,operating,acquisition,purchase,purchaseInPeriod,sale,saleInPeriod,gross,netVehicle,netPersonal,thg,reimbursements,realized,realizedPersonal: realized === null ? null : realized-reimbursements,unknownPrices,breakdown,ledger:ledger.sort((a,b)=>b.date.localeCompare(a.date)),distance,
    operatingPerTotal:ratio(operating,distance.total),operatingPerUseful:ratio(operating,distance.useful),netOperatingPerUseful:ratio(operating-thg-reimbursements,distance.useful),
    energy:{kwh:energy,sessions:charging.length,missingEnergy,missingPrices:charging.filter(e=>e.amount===null).length,measurements,averagePrice:ratio(pricedCost,pricedKwh),per100:ratio(energy*100,distance.total),kmPerKwh:distance.total === null ? null : ratio(distance.total,energy),opening,closing,adjusted,adjustedPer100:adjusted===null?null:ratio(adjusted*100,distance.total)}};
}
export function preliminaryTCO(data: Dataset, vehicle: string, resale: number) {
  if (!Number.isFinite(resale) || resale < 0) throw new Error('Resale value must be nonnegative');
  const r = report(data,vehicle);
  return r.purchase === null || r.v.sale || r.unknownPrices ? null : r.netVehicle-resale;
}
export function availableYears(data: Dataset): number[] {
  const years = new Set<number>();
  const add = (d?: string|null) => { if (d) years.add(Number(d.slice(0,4))); };
  for (const e of data.events) {
    add(e.date);
    if (e.type === 'expense') add(e.occurred_on);
    if ((e.type === 'expense' || e.type === 'income') && e.coverage) for (let y=Number(e.coverage.start.slice(0,4)); y<=Number(e.coverage.end.slice(0,4)); y++) years.add(y);
  }
  for (const v of data.vehicles) {add(v.handover);add(v.purchase.date);add(v.purchase.payment_date);add(v.sale?.date);add(v.sale?.payment_date);}
  return [...years].sort((a,b)=>b-a);
}
