import { acquisitionCategories } from './categories';

type BreakdownGroup = { label: string; total: number; expandable: boolean; categories: {category:string; amount:number}[] };

/** Presentation groups only; accounting categories and energy metrics stay separate. */
export function groupBreakdown(breakdown: Record<string,number>): BreakdownGroup[] {
  const groups = new Map<string,BreakdownGroup>();
  for (const [category,amount] of Object.entries(breakdown)) {
    const group = acquisitionCategories.includes(category) ? 'acquisition_costs'
      : ['charging','subscriptions'].includes(category) ? 'charging_and_subscriptions' : category;
    const label = group === 'acquisition_costs' ? 'Acquisition & Improvements'
      : group === 'charging_and_subscriptions' ? 'Charging & subscriptions'
      : category.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
    const entry = groups.get(group) ?? {label,total:0,expandable:group!==category || group==='acquisition_costs',categories:[]};
    entry.total += amount;
    entry.categories.push({category,amount});
    groups.set(group,entry);
  }
  return [...groups.values()].map(group=>({...group,categories:group.categories.sort((a,b)=>b.amount-a.amount || a.category.localeCompare(b.category))})).sort((a,b)=>b.total-a.total || a.label.localeCompare(b.label));
}
