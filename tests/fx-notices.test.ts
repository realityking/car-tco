import { expect, it } from 'vitest';
import { fxNotices } from '../src/accounting/fx-notices';
import type { FXIssue } from '../src/accounting/calculate';
const afterReportingMonths = new Date(2026,11,1);
const issue = (overrides: Partial<FXIssue> = {}): FXIssue => ({currency:'CZK',date:'2026-11-01',category:'charging',eur:10,status:'fallback',requestedMonth:'2026-11',rateMonth:'2026-09',...overrides});

it('deduplicates repeated transactions and lists fallback months chronologically',()=>{
  const notices=fxNotices([issue(),issue(),issue({requestedMonth:'2026-10'})],afterReportingMonths);
  expect(notices).toHaveLength(1);
  expect(notices[0]).toEqual({currency:'CZK',severity:'warning',message:'CZK: Earlier FX rates used: 2026-10 → 2026-09; 2026-11 → 2026-09. Totals may change when the monthly rates are added.'});
});
it('combines missing and fallback months into one error for the currency',()=>{
  const missing=issue({status:'missing',eur:null,rateMonth:null,requestedMonth:'2026-08'});
  const notices=fxNotices([missing,issue(),missing],afterReportingMonths);
  expect(notices).toHaveLength(1);
  expect(notices[0].severity).toBe('error');
  expect(notices[0].message).toContain('No usable FX rate for 2026-08.');
  expect(notices[0].message).toContain('2026-11 → 2026-09');
});
it('keeps currencies separate and ignores exact-rate transactions',()=>{
  const notices=fxNotices([issue({currency:'USD'}),issue(),issue({currency:'EUR',status:'exact'})],afterReportingMonths);
  expect(notices.map(n=>n.currency)).toEqual(['CZK','USD']);
  expect(fxNotices([])).toEqual([]);
});

it('suppresses only current-month fallback warnings',()=>{
  const now = new Date(2026,10,17);
  expect(fxNotices([issue(),issue()],now)).toEqual([]);
  const notices = fxNotices([issue(),issue({requestedMonth:'2026-10'})],now);
  expect(notices).toHaveLength(1);
  expect(notices[0].severity).toBe('warning');
  expect(notices[0].message).toContain('2026-10 → 2026-09');
  expect(notices[0].message).not.toContain('2026-11');
});
it('keeps current-month impossible conversions as errors',()=>{
  const missing = issue({status:'missing',eur:null,rateMonth:null});
  const notices = fxNotices([missing,issue()],new Date(2026,10,17));
  expect(notices).toEqual([{currency:'CZK',severity:'error',message:'CZK: No usable FX rate for 2026-11. Transactions in these payment months are excluded from all calculations.'}]);
});
it('starts warning once the month ends, including across year boundaries',()=>{
  const december = issue({requestedMonth:'2026-12'});
  expect(fxNotices([december],new Date(2026,11,31))).toEqual([]);
  expect(fxNotices([december],new Date(2027,0,1))[0].severity).toBe('warning');
});
