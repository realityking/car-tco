import type { FXIssue } from './calculate';

/** One notice per currency, regardless of how many transactions need that rate. */
export function fxNotices(issues: FXIssue[]) {
  const currencies = [...new Set(issues.filter(i => i.status !== 'exact').map(i => i.currency))].sort();
  return currencies.map(currency => {
    const matching = issues.filter(i => i.currency === currency);
    const missingMonths = [...new Set(matching.filter(i => i.status === 'missing').map(i => i.requestedMonth))].sort();
    const fallbacks = new Map(matching.filter(i => i.status === 'fallback').map(i => [i.requestedMonth, i.rateMonth]));
    const messages: string[] = [];
    if (missingMonths.length) messages.push(`No usable FX rate for ${missingMonths.join(', ')}. Transactions in these payment months are excluded from all calculations.`);
    if (fallbacks.size) messages.push(`Earlier FX rates used: ${[...fallbacks].sort(([a],[b]) => a.localeCompare(b)).map(([month,rateMonth]) => `${month} → ${rateMonth}`).join('; ')}. Totals may change when the monthly rates are added.`);
    return {currency, severity: missingMonths.length ? 'error' as const : 'warning' as const, message: `${currency}: ${messages.join(' ')}`};
  });
}
