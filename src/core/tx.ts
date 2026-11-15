// Transacties opbouwen, ondertekenen (lokaal) en versnellen met Replace-By-Fee.

import { hex } from '@scure/base';
import type { HDKey } from '@scure/bip32';
import { Address, OutScript, Transaction, selectUTXO } from '@scure/btc-signer';
import type { EsploraTx } from './esplora.ts';
import type { Utxo } from './scan.ts';
import { type AddressBook, type Chain, NETWORKS, type Net, privateKeyAt } from './wallet.ts';

/** nSequence met RBF aan (BIP125), zonder relatieve timelock. */
export const RBF_SEQUENCE = 0xfffffffd;
/** Dust-grens voor een P2WPKH-output. */
export const DUST = 294;

export interface InputRef {
  txid: string;
  vout: number;
  value: number;
  chain: Chain;
  index: number;
}

export interface Draft {
  tx: Transaction;
  inputs: InputRef[];
  to: string;
  amount: number;
  fee: number;
  feeRate: number;
  change?: { address: string; amount: number };
  vsize: number;
}

export class TxError extends Error {}

/** Coins die we mogen uitgeven: bevestigd, of ons eigen onbevestigde wisselgeld. */
export function spendable(utxos: Utxo[]): Utxo[] {
  return utxos.filter((u) => u.confirmed || u.chain === 1);
}

export function utxoKey(u: { txid: string; vout: number }): string {
  return `${u.txid}:${u.vout}`;
}

function toInput(u: Utxo, book: AddressBook) {
  return {
    txid: hex.decode(u.txid),
    index: u.vout,
    sequence: RBF_SEQUENCE,
    witnessUtxo: { script: book.at(u.chain, u.index).script, amount: BigInt(u.value) },
  };
}

export interface SendParams {
  utxos: Utxo[];
  to: string;
  /** Bedrag in sats; `'max'` stuurt alles (min fee) naar de ontvanger. */
  amount: number | 'max';
  feeRate: number; // sat/vB
  changeAddress: string;
  net: Net;
  book: AddressBook;
}

/** Bouwt een ongetekende transactie met coin selection (of alle gekozen coins bij 'max'). */
export function buildSend(p: SendParams): Draft {
  if (!(p.feeRate >= 1)) throw new TxError('De fee moet minimaal 1 sat/vB zijn.');
  if (p.utxos.length === 0) throw new TxError('Er zijn geen bevestigde coins om uit te geven.');
  const network = NETWORKS[p.net].btc;
  try {
    Address(network).decode(p.to);
  } catch {
    throw new TxError('Dit is geen geldig adres op dit netwerk.');
  }
  const inputs = p.utxos.map((u) => toInput(u, p.book));
  const opts = {
    feePerByte: BigInt(Math.ceil(p.feeRate)),
    network,
    createTx: true,
    bip69: true,
    dust: BigInt(DUST),
  };

  let sel;
  if (p.amount === 'max') {
    sel = selectUTXO(inputs, [], 'all', { ...opts, changeAddress: p.to });
  } else {
    if (!Number.isSafeInteger(p.amount) || p.amount < DUST) throw new TxError(`Het bedrag moet minimaal ${DUST} sats zijn.`);
    sel = selectUTXO(inputs, [{ address: p.to, amount: BigInt(p.amount) }], 'default', {
      ...opts,
      changeAddress: p.changeAddress,
    });
  }
  if (!sel || !sel.tx) throw new TxError('Onvoldoende saldo voor dit bedrag plus de fee.');

  const tx = sel.tx;
  const used = new Set(sel.inputs.map((i) => `${hex.encode(i.txid as Uint8Array)}:${i.index}`));
  const refs: InputRef[] = p.utxos
    .filter((u) => used.has(utxoKey(u)))
    .map(({ txid, vout, value, chain, index }) => ({ txid, vout, value, chain, index }));

  // Volgorde van de inputs in de transactie (BIP69 kan ze sorteren).
  const ordered: InputRef[] = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    const key = `${hex.encode(inp.txid!)}:${inp.index}`;
    const ref = refs.find((r) => utxoKey(r) === key);
    if (!ref) throw new TxError('Interne fout bij het koppelen van inputs.');
    ordered.push(ref);
  }

  const toScript = hex.encode(OutScript.encode(Address(network).decode(p.to)));
  let amount = 0;
  let change: Draft['change'];
  for (let i = 0; i < tx.outputsLength; i++) {
    const out = tx.getOutput(i);
    const value = Number(out.amount);
    if (hex.encode(out.script!) === toScript && (p.amount === 'max' || value === p.amount) && amount === 0) amount = value;
    else change = { address: p.changeAddress, amount: value };
  }
  const fee = Number(sel.fee);
  return { tx, inputs: ordered, to: p.to, amount, fee, feeRate: p.feeRate, ...(change ? { change } : {}), vsize: estimateVsize(tx) };
}

/** Geschatte vsize van een P2WPKH-transactie vóór ondertekenen. */
export function estimateVsize(tx: Transaction): number {
  let outBytes = 0;
  for (let i = 0; i < tx.outputsLength; i++) outBytes += 8 + 1 + tx.getOutput(i).script!.length;
  // 10,5 vB overhead (incl. segwit-markering), 68 vB per P2WPKH-input
  return Math.ceil(10.5 + 68 * tx.inputsLength + outBytes);
}

/** Ondertekent alle inputs met de account-privésleutel; sleutels worden direct gewist. */
export function signDraft(tx: Transaction, inputs: InputRef[], account: HDKey): { hex: string; txid: string; vsize: number } {
  inputs.forEach((ref, i) => {
    const key = privateKeyAt(account, ref.chain, ref.index);
    try {
      tx.signIdx(key, i);
    } finally {
      key.fill(0);
    }
  });
  tx.finalize();
  return { hex: tx.hex, txid: tx.id, vsize: tx.vsize };
}

export interface BumpDraft {
  tx: Transaction;
  inputs: InputRef[];
  oldFee: number;
  newFee: number;
  feeRate: number;
  changeAfter: number;
}

/**
 * Bouwt een vervangende transactie met een hogere fee (BIP125): dezelfde inputs
 * en ontvangers; alleen het wisselgeld wordt kleiner.
 */
export function buildBump(
  orig: EsploraTx,
  feeRate: number,
  locate: (address: string | undefined) => { chain: Chain; index: number } | null,
  book: AddressBook,
): BumpDraft {
  if (orig.status.confirmed) throw new TxError('Deze transactie is al bevestigd.');
  const inputs: InputRef[] = orig.vin.map((v) => {
    const loc = v.prevout ? locate(v.prevout.scriptpubkey_address) : null;
    if (!v.prevout || !loc) throw new TxError('Niet alle inputs zijn van deze wallet; versnellen kan niet.');
    return { txid: v.txid, vout: v.vout, value: v.prevout.value, ...loc };
  });
  if (!orig.vin.some((v) => v.sequence < 0xfffffffe)) throw new TxError('Deze transactie heeft RBF niet aangezet.');

  const changeIdx = orig.vout.findIndex((o) => locate(o.scriptpubkey_address)?.chain === 1);
  if (changeIdx === -1) throw new TxError('Deze transactie heeft geen wisselgeld om de hogere fee van te betalen.');

  const vsize = Math.ceil(orig.weight / 4);
  const oldFee = orig.fee;
  // Regel 3 en 4 van BIP125: nieuwe fee ≥ oude fee + 1 sat/vB × eigen grootte.
  const newFee = Math.max(Math.ceil(feeRate * vsize), oldFee + vsize);
  const change = orig.vout[changeIdx]!;
  const changeAfter = change.value - (newFee - oldFee);
  if (changeAfter < DUST) throw new TxError('Te weinig wisselgeld om de fee zo ver te verhogen.');

  const tx = new Transaction({ version: orig.version, lockTime: orig.locktime });
  for (const ref of inputs) {
    tx.addInput({
      txid: hex.decode(ref.txid),
      index: ref.vout,
      sequence: RBF_SEQUENCE,
      witnessUtxo: { script: book.at(ref.chain, ref.index).script, amount: BigInt(ref.value) },
    });
  }
  orig.vout.forEach((o, i) => {
    tx.addOutput({ script: hex.decode(o.scriptpubkey), amount: BigInt(i === changeIdx ? changeAfter : o.value) });
  });
  return { tx, inputs, oldFee, newFee, feeRate: newFee / vsize, changeAfter };
}

/** Kiest laag/normaal/hoog uit de fee-estimates (sat/vB per aantal blokken). */
export function feeLevels(est: Record<string, number>): { low: number; normal: number; high: number } {
  const pick = (target: number) => {
    const keys = Object.keys(est).map(Number).filter((k) => k >= target).sort((a, b) => a - b);
    const v = keys.length ? est[String(keys[0])] : undefined;
    return Math.max(1, Math.ceil(v ?? 1));
  };
  const high = pick(1);
  const normal = Math.min(high, pick(6));
  const low = Math.min(normal, pick(144));
  return { low, normal, high };
}
