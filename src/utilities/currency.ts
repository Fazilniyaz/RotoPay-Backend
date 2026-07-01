// src/utilities/currency.ts
// ─────────────────────────────────────────────
// Live currency conversion rates.
//
// Uses the free, key-less open.er-api.com endpoint (≈160 currencies, refreshed
// daily). Rates for a base currency are cached in-memory per UTC day, so the
// first request each day fetches fresh rates and the rest are instant. This
// gives "live, updated daily" conversion without hammering the provider.
// ─────────────────────────────────────────────

interface CachedRates {
  day: string; // YYYY-MM-DD (UTC)
  rates: Record<string, number>;
}

const cache = new Map<string, CachedRates>();

const todayKey = () => new Date().toISOString().slice(0, 10);

async function getRatesFor(base: string): Promise<Record<string, number>> {
  const day = todayKey();
  const cached = cache.get(base);
  if (cached && cached.day === day) return cached.rates;

  const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
  if (!res.ok) throw new Error(`Currency provider error (${res.status})`);

  const data = (await res.json()) as { result?: string; rates?: Record<string, number> };
  if (data.result !== "success" || !data.rates) {
    throw new Error("Currency provider returned no rates");
  }

  cache.set(base, { day, rates: data.rates });
  return data.rates;
}

// Conversion rate from → to (how many `to` units equal one `from` unit).
export async function getRate(from: string, to: string): Promise<number> {
  const a = from.toUpperCase();
  const b = to.toUpperCase();
  if (a === b) return 1;

  const rates = await getRatesFor(a);
  const rate = rates[b];
  if (typeof rate !== "number") {
    throw new Error(`No conversion rate available for ${a} → ${b}`);
  }
  return rate;
}

export const rateDate = todayKey;
