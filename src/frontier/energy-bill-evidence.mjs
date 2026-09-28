import crypto from 'node:crypto';

export const ENERGY_BILL_EVIDENCE_VERSION = 'energy-bill-evidence-v0.1.0';

const n = (v) => Number(v);
const ok = (v) => Number.isFinite(n(v)) && n(v) >= 0;
const stable = (v) => Array.isArray(v) ? v.map(stable) : (v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v);
const digest = (v) => crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');

function localClock(iso, timeZone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new TypeError('invalid timestamp');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(d).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { hour: n(parts.hour) + n(parts.minute) / 60, dayOfWeek: dayMap[parts.weekday], localDate: `${parts.year}-${parts.month}-${parts.day}` };
}

export function canonicaliseMeterIntervals(intervals = []) {
  if (!Array.isArray(intervals) || intervals.length === 0) return { status: 'invalid', errors: ['missing_intervals'] };
  const map = new Map();
  let duplicatesDropped = 0, revisionsApplied = 0;
  for (const [i, x] of intervals.entries()) {
    if (!x?.tenantId || !x?.siteId || !x?.meterPointId || !x?.start) return { status: 'invalid', errors: [`missing_identity:${i}`] };
    if (!ok(x.kWh) || !x.source?.provider || !x.source?.revision) return { status: 'invalid', errors: [`invalid_read:${i}`] };
    const key = `${x.tenantId}|${x.siteId}|${x.meterPointId}|${x.start}`;
    const prev = map.get(key);
    if (!prev) { map.set(key, x); continue; }
    const a = Number(prev.source.revisionSequence), b = Number(x.source.revisionSequence);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      if (b > a) { map.set(key, x); revisionsApplied++; continue; }
      if (b < a) { duplicatesDropped++; continue; }
    } else if (prev.source.revision !== x.source.revision) {
      return { status: 'invalid', errors: [`unorderable_revisions:${key}`] };
    }
    if (n(prev.kWh) !== n(x.kWh) || n(prev.kW ?? 0) !== n(x.kW ?? 0)) return { status: 'invalid', errors: [`conflicting_same_revision:${key}`] };
    duplicatesDropped++;
  }
  return { status: 'ok', intervals: [...map.values()].sort((a,b)=>new Date(a.start)-new Date(b.start)), duplicatesDropped, revisionsApplied };
}

function selectBand(interval, tariff) {
  const p = localClock(interval.start, tariff.timeZone);
  const matches = tariff.unitRates.filter(r => {
    if (r.daysOfWeek && !r.daysOfWeek.includes(p.dayOfWeek)) return false;
    if (r.startHour === undefined || r.endHour === undefined) return true;
    const s = n(r.startHour), e = n(r.endHour);
    return s <= e ? p.hour >= s && p.hour < e : p.hour >= s || p.hour < e;
  });
  if (matches.length !== 1) throw new Error(matches.length ? 'ambiguous_tariff_band' : 'missing_tariff_band');
  return matches[0];
}

function dayCount(period) {
  if (!period?.start || !period?.end) return null;
  const parse = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? Date.UTC(n(m[1]), n(m[2]) - 1, n(m[3])) : NaN;
  };
  const a = parse(period.start), b = parse(period.end);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? Math.round((b-a)/86400000) : null;
}

export function priceIndustrialElectricity({ tariff, intervals, billingPeriod }) {
  if (!tariff?.tenantId || !tariff?.siteId || !tariff?.meterPointId || !tariff?.timeZone || !Array.isArray(tariff.unitRates)) {
    return { status: 'unpriced', errors: ['incomplete_tariff_identity'] };
  }
  const canon = canonicaliseMeterIntervals(intervals);
  if (canon.status !== 'ok') return { status: 'unpriced', errors: canon.errors };
  let kWh = 0, energyGBP = 0;
  const priced = [];
  for (const [i, x] of canon.intervals.entries()) {
    if (x.tenantId !== tariff.tenantId || x.siteId !== tariff.siteId) return { status: 'unpriced', errors: [`scope_mismatch:${i}`] };
    if (x.meterPointId !== tariff.meterPointId) return { status: 'unpriced', errors: [`meter_point_mismatch:${i}`] };
    const band = selectBand(x, tariff);
    kWh += n(x.kWh);
    energyGBP += n(x.kWh) * n(band.pencePerKWh) / 100;
    priced.push({ start: x.start, kWh: n(x.kWh), kW: x.kW ?? null, rateId: band.id, pencePerKWh: n(band.pencePerKWh) });
  }

  const modelled = [], unmodelled = [];
  let extrasGBP = 0;
  const kWs = canon.intervals.map(x => n(x.kW)).filter(Number.isFinite);
  for (const c of tariff.chargeComponents ?? []) {
    if (c.includedInUnitRate === true) continue;
    let amount;
    if (c.type === 'per_kwh' && ok(c.ratePencePerKWh)) amount = kWh * n(c.ratePencePerKWh) / 100;
    else if (c.type === 'max_demand_gbp_per_kw' && ok(c.rateGBPPerKw) && kWs.length === canon.intervals.length) amount = Math.max(...kWs) * n(c.rateGBPPerKw);
    else if (c.type === 'fixed_period_gbp' && ok(c.amountGBP)) amount = n(c.amountGBP);
    else { unmodelled.push(c.id ?? 'unknown'); continue; }
    extrasGBP += amount;
    modelled.push({ id: c.id, type: c.type, amountGBP: amount });
  }

  const days = dayCount(billingPeriod);
  const standingGBP = days === null ? 0 : (n(tariff.standingChargePencePerDay ?? 0) * days / 100);
  return {
    status: unmodelled.length ? 'partially_priced' : 'priced',
    totalKWh: kWh, energyGBP, standingGBP, extraChargesGBP: extrasGBP,
    knownCostGBP: energyGBP + standingGBP + extrasGBP,
    modelledCharges: modelled, unmodelledCharges: unmodelled,
    intervalCount: canon.intervals.length, duplicatesDropped: canon.duplicatesDropped, revisionsApplied: canon.revisionsApplied,
    pricedIntervals: priced, evidenceHash: digest({ tariff, intervals: canon.intervals, billingPeriod })
  };
}

export function reconcileEnergyBill({ tariff, intervals, invoice, ledgerEntry, meterCoverage, toleranceGBP = 0.01 }) {
  const priced = priceIndustrialElectricity({ tariff, intervals, billingPeriod: invoice?.billingPeriod });
  if (!['priced','partially_priced'].includes(priced.status)) return { status: 'unreconciled', reason: 'unpriced', details: priced };
  if (!invoice || invoice.tenantId !== tariff.tenantId || invoice.siteId !== tariff.siteId || invoice.meterPointId !== tariff.meterPointId) {
    return { status: 'unreconciled', reason: 'invoice_identity_mismatch' };
  }
  const coverageComplete = meterCoverage?.complete === true &&
    Number.isFinite(n(meterCoverage.expectedIntervals)) &&
    n(meterCoverage.expectedIntervals) === priced.intervalCount;
  const unknown = [...priced.unmodelledCharges, ...(invoice.unpricedCharges ?? [])];
  const invoiceVarianceGBP = n(invoice.totalBeforeTaxGBP) - priced.knownCostGBP;
  let ledgerVarianceGBP = null;
  if (ledgerEntry) ledgerVarianceGBP = n(ledgerEntry.postedAmountGBP) - n(invoice.totalBeforeTaxGBP);
  const invoiceMatched = coverageComplete && unknown.length === 0 && Math.abs(invoiceVarianceGBP) <= toleranceGBP;
  const ledgerMatched = ledgerVarianceGBP === null || Math.abs(ledgerVarianceGBP) <= toleranceGBP;
  return {
    status: invoiceMatched && ledgerMatched ? 'reconciled' : 'needs_review',
    meteredKWh: priced.totalKWh, calculatedKnownCostGBP: priced.knownCostGBP,
    invoiceBeforeTaxGBP: n(invoice.totalBeforeTaxGBP), invoiceVarianceGBP,
    ledgerPostedGBP: ledgerEntry ? n(ledgerEntry.postedAmountGBP) : null, ledgerVarianceGBP,
    meterCoverageComplete: coverageComplete, unpricedCharges: unknown,
    exactSpendClaimAllowed: invoiceMatched && ledgerMatched,
    financeReconciled: invoiceMatched && ledgerEntry !== undefined && ledgerMatched,
    evidenceHash: digest({ priced: priced.evidenceHash, invoice, ledgerEntry, meterCoverage })
  };
}
