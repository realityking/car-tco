import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadData } from '../src/data/load';
import { eventSchema } from '../src/accounting/schema';
import { report } from '../src/accounting/calculate';

function fixture(check: (root: string) => void) {
  const root=mkdtempSync(join(tmpdir(),'car-tco-test-'));
  try {
    mkdirSync(join(root,'events'));
    for(const name of ['vehicles.yaml','exchange-rates.yaml']) writeFileSync(join(root,name),readFileSync(`examples/${name}`));
    writeFileSync(join(root,'events/2024.yaml'),readFileSync('examples/2024.yaml'));
    check(root);
  } finally { rmSync(root,{recursive:true,force:true}); }
}
describe('YAML integration',()=>{
  it('loads isolated example YAML and computes foreign-currency charging',()=>fixture(root=>{const d=loadData(root);const r=report(d,'example-car');expect(r.breakdown.charging).toBe(10);expect(r.energy.kwh).toBe(45);expect(r.reimbursements).toBe(75)}));
  it('fails build-time loading on missing required FX',()=>fixture(root=>{writeFileSync(join(root,'exchange-rates.yaml'),'rates: {}');expect(()=>loadData(root)).toThrow('Missing FX')}));
  it('rejects events stored in a different calendar year',()=>fixture(root=>{writeFileSync(join(root,'events/2025.yaml'),readFileSync('examples/2024.yaml'));expect(()=>loadData(root)).toThrow('date must be in file year')}));
  it('rejects non-finite numerical amounts',()=>{expect(()=>eventSchema.parse({vehicle:'example-car',date:'2024-01-01',type:'expense',category:'charging',currency:'EUR',amount:Infinity})).toThrow()});
});
