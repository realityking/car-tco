import { expect, it } from 'vitest';
import { fxNotices } from '../src/accounting/fx-notices';
import type { FXIssue } from '../src/accounting/calculate';
const issue = (overrides: Partial<FXIssue> = {}): FXIssue => ({currency:'CZK',date:'2026-11-01',category:'charging',eur:10,status:'fallback',requestedMonth:'2026-11',rateMonth:'2026-09',...overrides});

it('deduplicates repeated transactions and lists fallback months chronologically',()=>{
  const notices=fxNotices([issue(),issue(),issue({requestedMonth:'2026-10'})]);
  expect(notices).toHaveLength(1);
  expect(notices[0]).toEqual({currency:'CZK',severity:'warning',message:'CZK: Earlier FX rates used: 2026-10 → 2026-09; 2026-11 → 2026-09. Totals may change when the monthly rates are added.'});
});
it('combines missing and fallback months into one error for the currency',()=>{
  const missing=issue({status:'missing',eur:null,rateMonth:null,requestedMonth:'2026-08'});
  const notices=fxNotices([missing,issue(),missing]);
  expect(notices).toHaveLength(1);
  expect(notices[0].severity).toBe('error');
  expect(notices[0].message).toContain('No usable FX rate for 2026-08.');
  expect(notices[0].message).toContain('2026-11 → 2026-09');
});
it('keeps currencies separate and ignores exact-rate transactions',()=>{
  const notices=fxNotices([issue({currency:'USD'}),issue(),issue({currency:'EUR',status:'exact'})]);
  expect(notices.map(n=>n.currency)).toEqual(['CZK','USD']);
  expect(fxNotices([])).toEqual([]);
});
