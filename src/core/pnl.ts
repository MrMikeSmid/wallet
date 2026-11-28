// Winst/verlies op basis van de gemiddelde aankoopprijs (inleg).
// Ontvangsten tellen mee tegen de koers op dat moment; uitgaven verlagen de inleg naar rato.
export type PnlTx = { txid: string; delta: number; time?: number; confirmed: boolean };
export type Pnl = { cost: number; value: number; diff: number; pct: number; complete: boolean; loading: boolean };

/** priceAt: koers per txid; undefined = nog laden, null = onbekend. current: koers nu. */
export function computePnl(txs: PnlTx[], priceAt: (txid: string) => number | null | undefined, current: number, balanceSats: number): Pnl {
  const sorted = [...txs].sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
  let cost = 0, sats = 0, complete = true, loading = false;
  for (const t of sorted) {
    if (t.delta > 0) {
      const p = t.time ? priceAt(t.txid) : current; // onbevestigd: koers van nu
      if (p === undefined) loading = true;
      if (!p) { complete = false; continue; }
      cost += (t.delta / 1e8) * p;
      sats += t.delta;
    } else if (t.delta < 0 && sats > 0) {
      const left = Math.max(0, sats + t.delta);
      cost *= left / sats;
      sats = left;
    }
  }
  const value = (balanceSats / 1e8) * current;
  const diff = value - cost;
  return { cost, value, diff, pct: cost > 0 ? (diff / cost) * 100 : 0, complete, loading };
}
