import { z } from 'zod';

import { categories } from './categories';
export { categories, acquisitionCategories } from './categories';
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, 'Invalid calendar date');
const positive = z.number().nonnegative();
const soc = positive.max(100);
const currency = z.string().regex(/^[A-Z]{3}$/);
export const vehicleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), manufacturer: z.string().min(1), model: z.string().min(1),
  first_registration: date.nullable(), registration: date.nullable(), handover: date.nullable(),
  initial_state: z.object({ odometer_km: positive.nullable(), soc_percent: soc.nullable() }).strict(),
  battery: z.object({ usable_capacity_kwh: z.number().positive().nullable() }).strict().optional(),
  closing_state: z.object({ odometer_km: positive.nullable(), soc_percent: soc.nullable() }).strict().optional(),
}).strict().superRefine((v, ctx) => {
  const bad = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (v.closing_state?.odometer_km != null && v.initial_state.odometer_km != null && v.closing_state.odometer_km < v.initial_state.odometer_km) bad('Closing odometer precedes initial odometer');
});
const coverage = z.object({ start: date, end: date }).strict().refine(v => v.end >= v.start, 'Coverage end precedes start');
const base = { vehicle: z.string(), date, note: z.string().optional() };
const expense = z.object({
  ...base, type: z.literal('expense'), category: z.enum(categories), amount: positive.nullable(), currency,
  purchase_date: date.optional(), coverage: coverage.optional(), occurred_on: date.optional(), energy_kwh: positive.optional(),
  measurement: z.enum(['charger', 'battery', 'unknown']).optional(),
  source: z.string().optional(), source_record: z.string().optional(),
}).strict();
const income = z.object({ ...base, type: z.literal('income'), category: z.enum(['sale', 'thg', 'employer_reimbursement']), amount: positive, currency, sale_date: date.optional(), coverage: coverage.optional() }).strict();
const odometer = z.object({ ...base, type: z.literal('odometer'), odometer_km: positive }).strict();
const mileage = z.object({ ...base, type: z.literal('non_useful_mileage'), reason: z.enum(['collection', 'inspection', 'service']), km: positive }).strict();
export const eventSchema = z.discriminatedUnion('type', [expense, income, odometer, mileage]).superRefine((e, ctx) => {
  if (e.type === 'income') {
    if (e.category === 'sale' && e.coverage) ctx.addIssue({ code: 'custom', message: 'Sale is recognized at payment; coverage is not supported' });
    if (e.category !== 'sale' && e.sale_date) ctx.addIssue({ code: 'custom', message: 'sale_date belongs to sale only' });
  }
  if (e.type !== 'expense') return;
  if (e.category === 'purchase' && e.coverage) ctx.addIssue({ code: 'custom', message: 'Purchase is recognized at payment; coverage is not supported' });
  if (e.category !== 'purchase' && e.purchase_date) ctx.addIssue({ code: 'custom', message: 'purchase_date belongs to purchase only' });
  if (e.amount === null && e.category !== 'charging') ctx.addIssue({ code: 'custom', message: 'Only charging can have an unknown price' });
  if (e.category !== 'charging' && (e.energy_kwh !== undefined || e.measurement || e.occurred_on)) ctx.addIssue({ code: 'custom', message: 'Energy fields belong to charging only' });
});
export const ratesSchema = z.record(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), z.record(currency, z.number().positive())).superRefine((rates, ctx) => {
  for (const month of Object.values(rates)) if (month.EUR !== undefined && month.EUR !== 1) ctx.addIssue({ code: 'custom', message: 'EUR rate must equal 1' });
});
export type Vehicle = z.infer<typeof vehicleSchema>;
export type Event = z.infer<typeof eventSchema>;
export type Rates = z.infer<typeof ratesSchema>;
export type Expense = Extract<Event, {type: 'expense'}>;
export type Dataset = { vehicles: Vehicle[]; events: Event[]; rates: Rates };

export function validateDataset(data: Dataset): Dataset {
  const vehicles = z.array(vehicleSchema).min(1).parse(data.vehicles);
  const events = z.array(eventSchema).parse(data.events);
  const rates = ratesSchema.parse(data.rates);
  if (new Set(vehicles.map(v => v.id)).size !== vehicles.length) throw new Error('Duplicate vehicle ID');
  for (const e of events) if (!vehicles.some(v => v.id === e.vehicle)) throw new Error(`Unknown vehicle: ${e.vehicle}`);
  for (const v of vehicles) {
    const purchases = events.filter((e): e is Expense => e.vehicle === v.id && e.type === 'expense' && e.category === 'purchase');
    if (purchases.length > 1) throw new Error(`Duplicate purchase for ${v.id}: record the full purchase once`);
    const purchasedOn = purchases[0]?.purchase_date ?? purchases[0]?.date;
    const sales = events.filter((e): e is Extract<Event,{type:'income'}> => e.vehicle === v.id && e.type === 'income' && e.category === 'sale');
    if (sales.length > 1) throw new Error(`Duplicate sale for ${v.id}: record the full proceeds once`);
    const soldOn = sales[0]?.sale_date ?? sales[0]?.date;
    if (soldOn && purchasedOn && soldOn < purchasedOn) throw new Error(`Sale precedes purchase: ${v.id}`);
    if (soldOn && v.handover && soldOn < v.handover) throw new Error(`Sale precedes handover: ${v.id}`);
    if (v.closing_state && !soldOn) throw new Error(`Closing state requires a sale transaction: ${v.id}`);
    const readings = events.filter((e): e is Extract<Event, {type:'odometer'}> => e.vehicle === v.id && e.type === 'odometer').map(e => ({date:e.date, km:e.odometer_km}));
    const initialReading = v.handover && v.initial_state.odometer_km !== null ? {date:v.handover, km:v.initial_state.odometer_km} : null;
    // Handover precedes any later measurement taken on the first ownership day.
    if (initialReading) readings.unshift(initialReading);
    if (soldOn && v.closing_state?.odometer_km != null) readings.push({date:soldOn, km:v.closing_state.odometer_km});
    readings.sort((a,b) => a.date.localeCompare(b.date));
    for (let i=1; i<readings.length; i++) {
      if (readings[i].km < readings[i-1].km || (readings[i].date === readings[i-1].date && readings[i].km !== readings[i-1].km && readings[i-1] !== initialReading)) throw new Error(`Inconsistent odometer for ${v.id}`);
    }
    for (const e of events.filter(e => e.vehicle === v.id && (e.type === 'odometer' || e.type === 'non_useful_mileage'))) {
      if (!v.handover || e.date < v.handover || (soldOn && e.date > soldOn)) throw new Error(`Mileage outside ownership: ${v.id} ${e.date}`);
    }
  }
  return {vehicles, events, rates};
}
