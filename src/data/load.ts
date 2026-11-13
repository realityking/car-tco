import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { eventSchema, ratesSchema, validateDataset, vehicleSchema, type Event } from '../accounting/schema';
import { toEUR } from '../accounting/calculate';

export function loadData(root = resolve('data')) {
  const read = (path: string) => parse(readFileSync(resolve(root,path),'utf8'));
  const {vehicles} = z.object({vehicles:z.array(vehicleSchema)}).strict().parse(read('vehicles.yaml'));
  const {rates} = z.object({rates:ratesSchema}).strict().parse(read('exchange-rates.yaml'));
  const events: Event[] = [];
  for (const file of readdirSync(resolve(root,'events')).filter(f=>f.endsWith('.yaml')).sort()) {
    if (!/^\d{4}\.yaml$/.test(file)) throw new Error(`Expected one YYYY.yaml event file, got ${file}`);
    const annual = z.object({events:z.array(eventSchema)}).strict().parse(read(`events/${file}`));
    for (const [index,e] of annual.events.entries()) {
      if (!e.date.startsWith(file.slice(0,4)+'-')) throw new Error(`${file} entry ${index+1}: date must be in file year`);
      events.push(e);
    }
  }
  const data = validateDataset({vehicles,events,rates});
  // Validate every needed FX rate at build time, even for currently unselected vehicles.
  for (const e of events) if ((e.type==='expense' || e.type==='income') && e.amount!==null) toEUR(e.amount,e.currency,e.date,rates);
  for (const v of vehicles) for (const m of [v.sale]) if(m?.amount!=null && m.date) toEUR(m.amount,m.currency,m.payment_date??m.date,rates);
  return data;
}
