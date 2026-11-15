// Wachttijd na foute pincodes: de eerste 4 fouten kosten niets, vanaf de 5e
// loopt de wachttijd op (30 s, 1 min, 2 min, … tot maximaal 1 uur).

export const FREE_ATTEMPTS = 4;
export const WIPE_AFTER = 10;
const BASE_MS = 30_000;
const MAX_MS = 60 * 60_000;

/** Wachttijd in ms na `failures` foute pogingen op rij. */
export function delayAfter(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0;
  return Math.min(MAX_MS, BASE_MS * 2 ** (failures - FREE_ATTEMPTS - 1));
}

/** Moet de wallet gewist worden (alleen als de optie aanstaat)? */
export function shouldWipe(failures: number, wipeEnabled: boolean): boolean {
  return wipeEnabled && failures >= WIPE_AFTER;
}

/** "1 min 30 s" */
export function formatWait(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} s`;
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}
