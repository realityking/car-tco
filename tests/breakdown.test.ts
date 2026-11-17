import { expect, it } from 'vitest';
import { groupBreakdown } from '../src/accounting/breakdown';

it('groups the requested categories without duplicating costs or including purchase in acquisition',()=>{
  const source={purchase:30000,accessories:1000,acquisition:100,registration:50,charging:80,subscriptions:20,insurance:500};
  const groups=groupBreakdown(source);
  expect(groups.map(g=>[g.label,g.total])).toEqual([['Purchase',30000],['Acquisition & Improvements',1150],['Insurance',500],['Charging & subscriptions',100]]);
  expect(groups[1].categories).toEqual([{category:'accessories',amount:1000},{category:'acquisition',amount:100},{category:'registration',amount:50}]);
  expect(groups.reduce((sum,g)=>sum+g.total,0)).toBe(Object.values(source).reduce((sum,n)=>sum+n,0));
  expect(groups[0].expandable).toBe(false);
  expect(groups[1].expandable).toBe(true);
  expect(groups[3].categories).toHaveLength(2);
});
it('supports empty reports, a single recorded member and free charging',()=>{
  expect(groupBreakdown({})).toEqual([]);
  expect(groupBreakdown({subscriptions:20,charging:0})[0]).toMatchObject({label:'Charging & subscriptions',total:20,expandable:true});
  expect(groupBreakdown({acquisition:5})[0]).toMatchObject({label:'Acquisition & Improvements',total:5,expandable:true,categories:[{category:'acquisition',amount:5}]});
});
