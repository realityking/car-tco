# Car TCO

A static Astro + TypeScript dashboard for actual car ownership costs. YAML is the only source of truth. No database, backend, authentication, runtime API calls, or transaction IDs to maintain. Multiple vehicles share annual event files. The Q6 starts with unknown lifecycle values and **no invented expenses**.

## Run

Requires Node.js 22.23.4+, 24+, or 26+ and npm (verified with Node 26.10.0).

```sh
npm install
npm run dev
npm test
npm run build
npm run preview
```

`astro dev stop` stops the local development server when using Astro’s daemon mode.

`npm run build` type-checks the application, validates all YAML and the format of supplied FX rates, then produces a static `dist/`. Serve that folder with any static host. `npm ci` uses the committed lockfile for subsequent installs. The dashboard recalculates in the browser when you change vehicle, period, basis or the resale slider. Edit YAML and rebuild to update a deployed copy. Financial data is embedded in the static output; use a private hosting location if needed.

## Files and entry workflow

- `data/vehicles.yaml`: vehicle identifiers, lifecycle dates, optional sale and baseline readings. Purchase belongs in the annual event file.
- `data/events/YYYY.yaml`: one file per event/payment calendar year, containing an `events` list. Multiple cars use the same annual file; every entry requires `vehicle`.
- `data/exchange-rates.yaml`: monthly rates for automatic EUR conversion.
- `src/accounting/`: pure calculations, validation and future import interface, with no filesystem or network calls.
- `src/data/load.ts`: build-time YAML loading and cross-file validation.
- `examples/`: isolated, explicitly synthetic examples, never loaded into the real dashboard.
- `tests/`: synthetic fixtures and accounting tests.

Start by filling in the vehicle's known facts; leave unknown values `null`. Add actual financial events and odometer measurements. For a second car, add another vehicle with a unique ID and reference it in its events. Record the purchase once as an expense with category `purchase` in the payment year’s event file. Sale remains in the vehicle’s `sale` block for now; do not duplicate it as income.

## Vehicle lifecycle

`first_registration` is the first registration anywhere; `registration` is registration to you; `handover` is physical delivery and the start of measured ownership mileage.

`initial_state.odometer_km` and `soc_percent` describe handover. `battery.usable_capacity_kwh` is optional and must be actual known usable capacity. Add `sale` only after sale, with `date`, actual `amount`, `currency`, `odometer_km`, `soc_percent`, and optional `payment_date`. Unknown sale amount or readings can remain null. Dates use YYYY-MM-DD; amounts are nonnegative. Without a purchase transaction, the purchase price remains unknown, not zero. The example vehicle shows the full schema.

## Purchase transaction

No transaction IDs are needed.

Store the full actual purchase once in `data/events/YYYY.yaml`, using the payment year:

```yaml
# Schema example: replace placeholders with actual values before use.
events:
  - vehicle: your-vehicle-id
    date: YYYY-MM-DD # payment date
    type: expense
    category: purchase
    amount: ACTUAL_PRICE
    currency: EUR
    # purchase_date: YYYY-MM-DD # optional contract date if different
```

The purchase appears in the financial ledger and category breakdown and contributes exactly once to gross/net expenses and TCO. It is excluded from operating costs and energy metrics. Payment date determines the annual report and FX month in both cash and accrual views; optional `purchase_date` is informational. The MVP accepts at most one full-price purchase per vehicle and rejects duplicate purchases, coverage periods and missing amounts. Partial purchase payments are not yet modeled.


## Financial events

For expenses use `type: expense`, a fixed `category`, `amount`, `currency`, and `date` (payment date). Optional `note` is displayed beneath the category in the transaction overview; it does not affect calculations. All expense categories are validated:

| Group | Categories |
| --- | --- |
| Purchase | `purchase` |
| Acquisition & Improvements | `registration`, `acquisition`, `accessories` |
| Operating | `charging`, `fuel`, `insurance`, `vehicle_tax`, `maintenance`, `repairs`, `inspection`, `tyres`, `parking`, `tolls`, `cleaning`, `subscriptions` |

`acquisition` covers incidental costs of acquiring the vehicle, such as collection travel or purchase-related fees; the vehicle price itself belongs in `purchase`. Accessories remain a separate category in the breakdown and count toward acquisition costs and TCO, even when bought after handover. Acquisition & Improvements are excluded from operating costs/km. `registration` means initial acquisition registration costs. Put recurring vehicle tax in `vehicle_tax`. Gross amounts should include taxes you actually paid. The MVP does not model refundable deposits, financing principal/interest, refunds or partial purchase payments; do not force those into unrelated categories.

Income uses `type: income` with `category: thg` (vehicle-related) or `employer_reimbursement` (personal offset, always shown separately). No trip-level reimbursement attribution is needed.

Optional `coverage: { start: YYYY-MM-DD, end: YYYY-MM-DD }` allocates an expense or income evenly over **inclusive calendar days**. Accrual annual reports use the overlap with each calendar year, including leap days. Cash reports use the payment date. Without coverage, both use payment date. Lifetime sums count each item exactly once. Purchase is not depreciated: it is recognized at payment in both views, and coverage is not allowed on purchase transactions.

### FX

Rates are **foreign currency units per 1 EUR**. An amount of 250 CZK with rate 25 becomes EUR 10. Use the event's **payment month**, even if its coverage belongs to another year. Purchase uses the transaction’s `date` (payment date). Sale uses its payment date override, or its date. EUR is implicitly 1; a zero-priced charge needs no exchange rate. If the payment month has no rate for the currency, the latest earlier available month is used and the dashboard shows one notice per currency listing affected payment months and the earlier rate month used for each. Future rates are never used. If no usable rate exists, the build still succeeds: the transaction remains visible, a currency-level error lists the affected months, and the transaction is excluded from all calculations, including charging energy and price/kWh metrics. Expense and income totals then describe only included records. Realized and preliminary TCO are withheld while any required FX rate is unavailable. Missing FX is distinct from an unknown charging price. Adding the monthly rate and rebuilding automatically replaces the fallback or restores excluded transactions. Currency codes must be uppercase three-letter codes.

Maintain monthly source rates, not converted transaction amounts. Select a consistent monthly rate source/convention and document it in YAML comments. There is no automatic exchange-rate download in the MVP. Calculations preserve precision until display rounding to avoid cumulative rounding drift.

## Reports and definitions

The cost breakdown groups accessories, acquisition and registration under **Acquisition & Improvements**, and charging plus subscriptions under **Charging & subscriptions**. Select either group’s name to expand it to see its individual categories and amounts. This presentation grouping does not change accounting or charging-session metrics.

- **Gross recorded expenses** = purchase in period + acquisition fees + operating costs.
- **Net vehicle expenses** = gross − THG income, before sale.
- **Personal net expenses** = net vehicle expenses − employer reimbursements, before sale.
- **Realized lifetime TCO** = actual purchase + acquisition + operating − THG − actual sale proceeds. Available only in Lifetime after sale with known purchase/sale prices and no recorded unknown charging prices or missing usable FX rates. A separate figure includes employer reimbursements.
- Operating cost/km excludes purchase and acquisition. Gross operating costs are divided by total or useful distance; a separate net rate subtracts THG and reimbursements.
- The optional resale slider estimates lifetime TCO using recorded-to-date costs and an assumed resale value. It is clearly hypothetical, does not write YAML or change actual totals, and does not forecast future operating costs. It is disabled without a known purchase price or with unknown charging prices or missing usable FX rates.

Totals are always based on recorded entries. The application cannot certify that every receipt, charge or reimbursement has been entered. Zero means no known amount in the selected view; missing prices and readings are explicitly marked. Annual views appear from dated source records and coverage periods, not the machine's current date.

## Mileage

Use `type: odometer` with `date` and `odometer_km`. Use `type: non_useful_mileage`, `reason: collection | inspection | service`, and `km` for distance that does not provide useful transport. Costs are not assigned to individual journeys.

Total km = closing − opening odometer. Useful km = total − non-useful km. Lifecycle handover/sale readings are included automatically. For annual reports record exact **January 1 boundary readings**; the reading on 2025-01-01 closes 2024 and opens 2025. For the first/last ownership year the handover/sale is the boundary. An ongoing period uses the latest available reading, and the UI shows its measurement window. There is no interpolation. If a boundary is missing, per-km metrics remain unavailable. Update readings through the costs' reporting horizon for meaningful comparisons. A zero denominator gives no ratio; excessive excluded mileage is flagged. Decreasing or conflicting same-day readings fail validation.

## Charging and energy

Use `category: subscriptions` for charging-card membership or monthly tariff fees. These count toward operating costs and TCO, but are not charging sessions, require no kWh, and are excluded from the session-based average price/kWh. Use `category: charging` for actual charging sessions. Add a coverage period to subscription fees when its dates are known.

Charging expenses optionally include `energy_kwh`, `measurement: charger | battery | unknown`, and `occurred_on` (session date). Financial allocation uses payment/coverage; energy aggregation uses session date, falling back to payment date. Record free charging with `amount: 0`. `amount: null` is permitted only for charging and means **unknown price**, never free. Such entries contribute known energy but are flagged as missing financial costs.

Energy completeness shows how many **recorded** sessions have kWh; it cannot establish coverage of absent sessions. Average price/kWh uses only records with both a known price and kWh, including free energy. Energy/100 km and km/kWh use total distance and all recorded kWh, and are labeled as charging-based metrics. Partial energy records are flagged.

After sale, lifetime inventory-adjusted energy = recorded charged energy + usable capacity × opening SoC − usable capacity × closing SoC. Both SoCs and capacity must be known, all recorded charges must have kWh, and the result must be nonnegative. Annual inventory adjustment is not calculated without annual SoC boundaries. Opening/closing battery energy never creates a financial transaction: it is already included in the actual purchase/sale. Charger-side data includes charging losses; mixed measurement sources cannot be presented as precise battery consumption.

## Future Audi imports

`src/accounting/imports.ts` defines a validated normalized session interface, conservative reconciliation and an unknown-cost event converter. A future parser can translate real Audi exports into this interface while retaining source, external source-record key, date, kWh and measurement type. Source-record keys come from the importer, not from the user. Exact source links can match; same-day candidates always require review, avoiding automatic merges and double counting. Repeated source records are flagged. Unmatched sessions can become charging records with a null price, then be completed from invoices. Do not add both the imported session and an existing expense for the same charge.

No Audi API connector or format-specific importer is included: a real export is needed to implement and verify the parser. No login credentials are needed by the dashboard.

## Verification

`npm test` covers FX, leap-year coverage allocation, payment timing, multi-vehicle isolation, mileage boundaries and denominators, free and unknown-price charging, battery inventory, realized versus hypothetical TCO, schema rejection and import reconciliation. `npm run build` includes Astro/TypeScript checks and source-data validation. The project uses Astro's [static output](https://docs.astro.build/en/reference/configuration-reference/) and [bundled TypeScript browser scripts](https://docs.astro.build/en/guides/client-side-scripts/); no UI framework is needed.
