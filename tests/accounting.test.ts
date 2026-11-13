import { describe, expect, it } from 'vitest';
import { annualShare, availableYears, mileage, preliminaryTCO, report, toEUR } from '../src/accounting/calculate';
import { eventSchema, validateDataset, vehicleSchema, type Dataset, type Event, type Vehicle } from '../src/accounting/schema';
import { missingCostEvent, reconcileSessions, type ImportedSession } from '../src/accounting/imports';

const vehicle: Vehicle = {id:'test',manufacturer:'Synthetic',model:'Test fixture',first_registration:null,registration:null,handover:'2024-01-01',initial_state:{odometer_km:1000,soc_percent:80},battery:{usable_capacity_kwh:80}};
const expense = (overrides:Partial<Extract<Event,{type:'expense'}>>={}): Extract<Event,{type:'expense'}> => ({vehicle:'test',type:'expense',date:'2024-06-01',category:'charging',amount:100,currency:'EUR',energy_kwh:200,measurement:'charger',...overrides});
const purchase: Event = {vehicle:'test',type:'expense',category:'purchase',date:'2024-01-01',purchase_date:'2023-12-20',amount:30000,currency:'EUR'};
const dataset = (events:Event[]=[], v:Vehicle=structuredClone(vehicle), includePurchase=true):Dataset => ({vehicles:[v],events:includePurchase?[purchase,...events]:events,rates:{'2024-06':{CZK:25}}});

describe('FX',()=>{
  it('converts foreign units per EUR and permits EUR without a rate',()=>{expect(toEUR(250,'CZK','2024-06-01',{'2024-06':{CZK:25}})).toBe(10);expect(toEUR(17,'EUR','2024-01-01',{})).toBe(17)});
  it('uses exact payment month; never silently falls back',()=>{expect(()=>toEUR(100,'CZK','2024-07-01',{'2024-06':{CZK:25}})).toThrow('Missing FX');expect(toEUR(0,'CZK','2024-07-01',{})).toBe(0)});
});
describe('annual allocation',()=>{
  const e={date:'2023-12-01',coverage:{start:'2023-07-01',end:'2024-06-30'}};
  it('uses inclusive coverage days, including leap day',()=>{expect(annualShare(e,2023,'accrual')).toBe(184/366);expect(annualShare(e,2024,'accrual')).toBe(182/366);expect(annualShare(e,2023,'accrual')+annualShare(e,2024,'accrual')).toBe(1)});
  it('cash follows payment date and lifetime never duplicates',()=>{expect(annualShare(e,2023,'cash')).toBe(1);expect(annualShare(e,2024,'cash')).toBe(0);expect(annualShare(e,null,'accrual')).toBe(1)});
  it('supports a one-day coverage period',()=>expect(annualShare({date:'2023-12-01',coverage:{start:'2024-02-29',end:'2024-02-29'}},2024,'accrual')).toBe(1));
  it('converts before allocating and retains payment-month FX',()=>{const r=report(dataset([expense({amount:250,currency:'CZK',coverage:{start:'2024-12-31',end:'2025-01-01'}})]),'test',2025);expect(r.operating).toBe(5)});
  it('finds every coverage year and purchase payment year',()=>expect(availableYears(dataset([expense({coverage:{start:'2024-01-01',end:'2026-12-31'}})]))).toEqual([2026,2025,2024]));
});
describe('financial separation and TCO',()=>{
  const events:Event[]=[expense(),expense({category:'registration',amount:50,energy_kwh:undefined,measurement:undefined}),{vehicle:'test',type:'income',category:'thg',date:'2024-06-01',amount:30,currency:'EUR'},{vehicle:'test',type:'income',category:'employer_reimbursement',date:'2024-06-01',amount:20,currency:'EUR'}];
  it('separates operating, acquisition, THG and employer money',()=>{const r=report(dataset(events),'test');expect(r.operating).toBe(100);expect(r.acquisition).toBe(50);expect(r.gross).toBe(30150);expect(r.netVehicle).toBe(30120);expect(r.netPersonal).toBe(30100);expect(r.realized).toBeNull()});
  it('uses purchase payment date without depreciating',()=>{expect(report(dataset(events),'test',2023).purchaseInPeriod).toBe(0);expect(report(dataset(events),'test',2024).purchaseInPeriod).toBe(30000)});
  it('only recognizes realized lifetime TCO after sale',()=>{const v={...vehicle,sale:{date:'2025-01-01',amount:20000,currency:'EUR',odometer_km:11000,soc_percent:30}};const r=report(dataset(events,v),'test');expect(r.realized).toBe(10120);expect(r.realizedPersonal).toBe(10100);expect(report(dataset(events,v),'test',2024).realized).toBeNull()});
  it('keeps hypothetical resale out of actual totals',()=>{const d=dataset(events);expect(preliminaryTCO(d,'test',20000)).toBe(10120);expect(report(d,'test').netVehicle).toBe(30120);expect(()=>preliminaryTCO(d,'test',-1)).toThrow()});
  it('does not fabricate unknown purchase or charging amounts',()=>{const d=dataset([expense({amount:null})],vehicle,false);const r=report(d,'test');expect(r.purchase).toBeNull();expect(r.unknownPrices).toBe(1);expect(r.ledger[0].eur).toBeNull();expect(preliminaryTCO(d,'test',0)).toBeNull()});
  it('isolates vehicles',()=>{const d=dataset(events);d.vehicles.push({...vehicle,id:'second'});expect(report(d,'second').operating).toBe(0)});
});
describe('mileage',()=>{
  const events:Event[]=[{vehicle:'test',type:'odometer',date:'2025-01-01',odometer_km:11000},{vehicle:'test',type:'non_useful_mileage',date:'2024-01-01',reason:'collection',km:100}];
  it('subtracts non-useful mileage without assigning trips',()=>{const d=mileage(vehicle,events,2024);expect(d.total).toBe(10000);expect(d.useful).toBe(9900)});
  it('requires exact annual opening readings',()=>expect(mileage(vehicle,[{vehicle:'test',type:'odometer',date:'2026-01-01',odometer_km:21000}],2025).total).toBeNull());
  it('zero distance cannot cause Infinity',()=>{const r=report(dataset(),'test');expect(r.operatingPerUseful).toBeNull();expect(r.energy.per100).toBeNull()});
  it('invalid excluded mileage is flagged',()=>expect(mileage(vehicle,[{vehicle:'test',type:'non_useful_mileage',date:'2024-01-01',reason:'service',km:2}],null).invalid).toBe(true));
});
describe('energy',()=>{
  it('includes free energy and uses a matched price/kWh subset',()=>{const r=report(dataset([expense(),expense({amount:0,energy_kwh:100}),expense({amount:50,energy_kwh:undefined})]),'test');expect(r.energy.kwh).toBe(300);expect(r.energy.averagePrice).toBeCloseTo(100/300);expect(r.energy.missingEnergy).toBe(1)});
  it('uses session date independently of payment and coverage',()=>{const r=report(dataset([expense({occurred_on:'2023-12-31'})]),'test',2023);expect(r.energy.kwh).toBe(200);expect(r.operating).toBe(0)});
  it('adjusts lifetime opening and closing energy without changing costs',()=>{const v={...vehicle,sale:{date:'2025-01-01',amount:20000,currency:'EUR',odometer_km:11000,soc_percent:30}};const r=report(dataset([expense()],v),'test');expect(r.energy.adjusted).toBe(240);expect(r.energy.adjustedPer100).toBe(2.4);expect(r.realized).toBe(10100);expect(report(dataset([expense()],v),'test',2024).energy.adjusted).toBeNull()});
  it('withholds inventory estimate with missing kWh or closing SoC',()=>{expect(report(dataset([expense()]),'test').energy.adjusted).toBeNull();const v={...vehicle,sale:{date:'2025-01-01',amount:20000,currency:'EUR',odometer_km:11000,soc_percent:30}};expect(report(dataset([expense({energy_kwh:undefined})],v),'test').energy.adjusted).toBeNull()});
});
describe('validation',()=>{
  it('accepts a vehicle without purchase metadata',()=>{expect(vehicleSchema.parse(vehicle)).toEqual(vehicle);expect(report(dataset([],vehicle,false),'test').purchase).toBeNull()});
  it('rejects categories, impossible dates, negative prices and bad SoC',()=>{expect(()=>eventSchema.parse({...expense(),category:'misc'})).toThrow();expect(()=>eventSchema.parse({...expense(),date:'2024-02-30'})).toThrow();expect(()=>eventSchema.parse({...expense(),amount:-1})).toThrow();expect(()=>vehicleSchema.parse({...vehicle,initial_state:{odometer_km:0,soc_percent:101}})).toThrow()});
  it('rejects manual transaction IDs and invalid coverage',()=>{expect(()=>eventSchema.parse({...expense(),id:'manual'})).toThrow();expect(()=>eventSchema.parse({...expense(),coverage:{start:'2024-03-01',end:'2024-02-01'}})).toThrow()});
  it('rejects unknown vehicles and duplicate vehicle IDs',()=>{expect(()=>validateDataset(dataset([{...expense(),vehicle:'missing'}]))).toThrow('Unknown vehicle');const d=dataset();d.vehicles.push(vehicle);expect(()=>validateDataset(d)).toThrow('Duplicate')});
  it('rejects inconsistent odometer and mileage outside ownership',()=>{expect(()=>validateDataset(dataset([{vehicle:'test',type:'odometer',date:'2024-06-01',odometer_km:500}]))).toThrow('Inconsistent');expect(()=>validateDataset(dataset([{vehicle:'test',type:'non_useful_mileage',date:'2023-06-01',reason:'collection',km:50}]))).toThrow('outside ownership')});
  it('permits unknown charging prices but no other null expenses',()=>{expect(eventSchema.parse(expense({amount:null})).type).toBe('expense');expect(()=>eventSchema.parse(expense({amount:null,category:'insurance',energy_kwh:undefined,measurement:undefined}))).toThrow()});
});
describe('future import boundary',()=>{
  const s:ImportedSession={vehicle:'test',source:'audi-export',source_record:'external-1',date:'2024-06-01',energy_kwh:200,measurement:'battery'};
  it('never auto-merges plausible same-day charges',()=>expect(reconcileSessions([s],[expense()])[0].status).toBe('review'));
  it('detects imported duplicates and exact source matches',()=>{expect(reconcileSessions([s,s],[]).map(r=>r.status)).toEqual(['missing_cost','duplicate_import']);expect(reconcileSessions([s],[{...expense(),source:s.source,source_record:s.source_record}])[0].status).toBe('linked')});
  it('unknown costs are not confused with free charging',()=>expect(missingCostEvent(s).amount).toBeNull());
});

describe('purchase transactions',()=>{
  it('counts purchase once in totals and includes it in the ledger and breakdown',()=>{
    const r=report(dataset([expense()]),'test');
    expect(r.purchase).toBe(30000);
    expect(r.gross).toBe(30100);
    expect(r.breakdown.purchase).toBe(30000);
    expect(r.ledger.filter(e=>e.label==='purchase')).toHaveLength(1);
    expect(r.operating).toBe(100);
    expect(r.acquisition).toBe(0);
    expect(r.energy.sessions).toBe(1);
    expect(r.purchasedOn).toBe('2023-12-20');
  });
  it('converts purchases using payment-month FX for both bases',()=>{
    const d=dataset([{...purchase,date:'2024-06-01',amount:750000,currency:'CZK'}],vehicle,false);
    for (const basis of ['cash','accrual'] as const) {
      expect(report(d,'test',2024,basis).purchaseInPeriod).toBe(30000);
      expect(report(d,'test',2023,basis).gross).toBe(0);
    }
    expect(availableYears(d)).toEqual([2024]);
  });
  it('keeps an explicitly zero-priced acquisition distinct from a missing purchase',()=>{
    expect(report(dataset([{...purchase,amount:0}],vehicle,false),'test').purchase).toBe(0);
    expect(report(dataset([],vehicle,false),'test').purchase).toBeNull();
  });
  it('does not share purchase prices between vehicles',()=>{
    const d=dataset(); d.vehicles.push({...vehicle,id:'second'});
    expect(report(d,'second').purchase).toBeNull();
    expect(report(d,'second').gross).toBe(0);
  });
  it('rejects duplicate purchases and legacy vehicle purchase blocks',()=>{
    expect(()=>validateDataset(dataset([purchase]))).toThrow('Duplicate purchase');
    expect(()=>vehicleSchema.parse({...vehicle,purchase:{date:'2024-01-01',amount:30000,currency:'EUR'}})).toThrow();
  });
  it('rejects purchase coverage and unknown amounts',()=>{
    expect(()=>eventSchema.parse({...purchase,coverage:{start:'2024-01-01',end:'2025-01-01'}})).toThrow('coverage');
    expect(()=>eventSchema.parse({...purchase,amount:null})).toThrow();
    expect(()=>eventSchema.parse({...expense(),purchase_date:'2024-01-01'})).toThrow();
  });
  it('rejects a sale preceding the purchase contract',()=>{
    const v={...vehicle,handover:null,sale:{date:'2023-12-01',amount:20000,currency:'EUR',odometer_km:null,soc_percent:null}};
    expect(()=>validateDataset(dataset([],v))).toThrow('Sale precedes purchase');
  });
});
