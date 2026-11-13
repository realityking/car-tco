import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { eventSchema, ratesSchema, validateDataset, vehicleSchema, type Event } from '../accounting/schema';

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
  // Missing rates are reported by the dashboard, not fatal to loading/building.
  return validateDataset({vehicles,events,rates});
}
