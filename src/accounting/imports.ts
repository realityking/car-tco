import { z } from 'zod';
import { chargingDetails, date, type Expense } from './schema';

// Adapter boundary for a future Audi export parser; no credentials or network calls.
export const importedSessionSchema = z.object({
  ...chargingDetails,
  source: z.string().min(1), source_record: z.string().min(1), vehicle: z.string().min(1),
  date, energy_kwh: z.number().nonnegative(), duration_minutes: z.number().nonnegative().optional(), measurement: z.enum(['charger','battery','unknown']),
}).strict();
export type ImportedSession = z.infer<typeof importedSessionSchema>;
export function reconcileSessions(input: ImportedSession[], recorded: Expense[]) {
  const sessions = z.array(importedSessionSchema).parse(input);
  const seen = new Set<string>();
  return sessions.map(s => {
    const key = JSON.stringify([s.source,s.source_record,s.vehicle]);
    if (seen.has(key)) return {session:s,status:'duplicate_import' as const,candidates:[]};
    seen.add(key);
    const exact = recorded.filter(e => e.vehicle===s.vehicle && e.category==='charging' && e.source===s.source && e.source_record===s.source_record);
    if (exact.length) return {session:s,status:'linked' as const,candidates:exact};
    // A same-day match is only a suggestion: charger and battery kWh may differ.
    const candidates = recorded.filter(e => e.vehicle===s.vehicle && e.category==='charging' && (e.occurred_on??e.date)===s.date);
    return {session:s,status:candidates.length?'review' as const:'missing_cost' as const,candidates};
  });
}
export function missingCostEvent(session: ImportedSession): Expense {
  const s = importedSessionSchema.parse(session);
  return {...s,type:'expense',category:'charging',amount:null,currency:'EUR',occurred_on:s.date};
}
