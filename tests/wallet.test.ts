// Scannen (gap limit), saldo, geschiedenis, versturen en versnellen (RBF).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hex } from '@scure/base';
import { Transaction } from '@scure/btc-signer';
import { Esplora, type EsploraTx } from '../src/core/esplora.ts';
import { scanWallet, summarizeTx, type Utxo } from '../src/core/scan.ts';
import { DUST, RBF_SEQUENCE, TxError, buildBump, buildSend, feeLevels, signDraft, spendable } from '../src/core/tx.ts';
import { AddressBook, accountKey, accountXpubs } from '../src/core/wallet.ts';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const book = new AddressBook(accountXpubs(ABANDON, '').test, 'test');
const EXTERN = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const stats = (funded = 0, spent = 0, n = 0) => ({ funded_txo_sum: funded, spent_txo_sum: spent, tx_count: n });

/** Nep-Esplora: alleen de adressen in `used` hebben transacties. */
function fakeApi(used: Record<string, { confirmed: number; mempool?: number }>) {
  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    const path = url.replace('https://x/api', '');
    calls.push(path);
    const m = /^\/address\/([^/]+)(\/txs|\/utxo)?$/.exec(path);
    if (!m) return new Response('niet gevonden', { status: 404 });
    const addr = decodeURIComponent(m[1]!);
    const u = used[addr];
    if (!m[2]) {
      return Response.json({
        address: addr,
        chain_stats: u ? stats(u.confirmed, 0, 1) : stats(),
        mempool_stats: u?.mempool ? stats(u.mempool, 0, 1) : stats(),
      });
    }
    if (m[2] === '/utxo') return Response.json(u ? [{ txid: 'aa'.repeat(32), vout: 0, value: u.confirmed, status: { confirmed: true } }] : []);
    return Response.json(u ? [{
      txid: hex.encode(new TextEncoder().encode(addr)).slice(0, 64).padEnd(64, '0'), version: 2, locktime: 0, weight: 561, fee: 141,
      vin: [{ txid: 'bb'.repeat(32), vout: 0, sequence: 0xffffffff, prevout: { scriptpubkey: '00', scriptpubkey_address: EXTERN, value: u.confirmed + 141 } }],
      vout: [{ scriptpubkey: '00', scriptpubkey_address: addr, value: u.confirmed }],
      status: { confirmed: true, block_height: 100, block_time: 1_700_000_000 },
    }] : []);
  };
  return { api: new Esplora('https://x/api', fetchFn), calls };
}

const noPause = { pause: async () => {}, shuffle: <T>(a: T[]) => a };

test('scannen: gap limit 20 op beide ketens, saldo en geschiedenis', async () => {
  const used = {
    [book.at(0, 0).address]: { confirmed: 10_000 },
    [book.at(0, 3).address]: { confirmed: 5_000, mempool: 700 },
    [book.at(1, 0).address]: { confirmed: 2_000 },
  };
  const { api, calls } = fakeApi(used);
  const res = await scanWallet(book, api, noPause);
  assert.deepEqual(res.lastUsed, { 0: 3, 1: 0 });
  const statCalls = calls.filter((c) => /^\/address\/[^/]+$/.test(c));
  assert.equal(statCalls.length, 24 + 21); // receive 0..23, change 0..20
  assert.equal(res.confirmed, 17_000);
  assert.equal(res.unconfirmed, 700);
  assert.equal(res.utxos.length, 3);
  assert.equal(res.txs.length, 3);
  assert.ok(res.txs.every((t) => t.net > 0 && !t.bumpable));
  // Nooit iets anders dan adres-verzoeken.
  assert.ok(calls.every((c) => c.startsWith('/address/')));
});

test('scannen: lege wallet stopt na 20 adressen per keten', async () => {
  const { api, calls } = fakeApi({});
  const res = await scanWallet(book, api, noPause);
  assert.equal(calls.length, 40);
  assert.equal(res.confirmed, 0);
  assert.deepEqual(res.lastUsed, { 0: -1, 1: -1 });
});

test('scannen: verzoeken in willekeurige volgorde', async () => {
  const { api, calls } = fakeApi({});
  await scanWallet(book, api, { pause: async () => {} });
  const order = calls.slice(0, 20).map((c) => c.split('/')[2]);
  const expected = Array.from({ length: 20 }, (_, i) => book.at(0, i).address);
  assert.deepEqual([...order].sort(), [...expected].sort());
  assert.notDeepEqual(order, expected);
});

function utxo(value: number, chain: 0 | 1, index: number, n: number, confirmed = true): Utxo {
  return { txid: n.toString(16).padStart(64, '0'), vout: 0, value, confirmed, address: book.at(chain, index).address, chain, index };
}

test('versturen: coin selection, wisselgeld, fee en ondertekenen', () => {
  const utxos = [utxo(50_000, 0, 0, 1), utxo(30_000, 0, 1, 2)];
  const draft = buildSend({ utxos, to: EXTERN, amount: 60_000, feeRate: 5, changeAddress: book.at(1, 0).address, net: 'test', book });
  assert.equal(draft.amount, 60_000);
  assert.equal(draft.inputs.length, 2);
  assert.ok(draft.change && draft.change.amount > DUST);
  assert.equal(draft.amount + draft.fee + draft.change!.amount, 80_000);
  for (let i = 0; i < draft.tx.inputsLength; i++) assert.equal(draft.tx.getInput(i).sequence, RBF_SEQUENCE);

  const acc = accountKey(ABANDON, '', 'test');
  const signed = signDraft(draft.tx, draft.inputs, acc);
  acc.wipePrivateData();
  assert.match(signed.txid, /^[0-9a-f]{64}$/);
  assert.ok(Math.abs(signed.vsize - draft.vsize) <= 2, `vsize ${signed.vsize} vs schatting ${draft.vsize}`);
  assert.ok(draft.fee / signed.vsize >= 4.9);
  // De ondertekende transactie is weer in te lezen.
  assert.equal(Transaction.fromRaw(hex.decode(signed.hex)).id, signed.txid);
});

test('versturen: alles versturen (max) geeft één output zonder wisselgeld', () => {
  const utxos = [utxo(50_000, 0, 0, 1), utxo(30_000, 1, 0, 2)];
  const draft = buildSend({ utxos, to: EXTERN, amount: 'max', feeRate: 2, changeAddress: book.at(1, 1).address, net: 'test', book });
  assert.equal(draft.tx.outputsLength, 1);
  assert.equal(draft.change, undefined);
  assert.equal(draft.amount + draft.fee, 80_000);
});

test('versturen: fouten', () => {
  const utxos = [utxo(10_000, 0, 0, 1)];
  const base = { utxos, feeRate: 1, changeAddress: book.at(1, 0).address, net: 'test' as const, book };
  assert.throws(() => buildSend({ ...base, to: EXTERN, amount: 20_000 }), TxError);
  assert.throws(() => buildSend({ ...base, to: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', amount: 1_000 }), /geldig adres/);
  assert.throws(() => buildSend({ ...base, to: EXTERN, amount: 100 }), /minimaal/);
  assert.throws(() => buildSend({ ...base, to: EXTERN, amount: 1_000, feeRate: 0 }), /fee/);
  assert.throws(() => buildSend({ ...base, utxos: [], to: EXTERN, amount: 1_000 }), /coins/);
});

test('alleen bevestigde coins of eigen wisselgeld zijn uit te geven', () => {
  const list = [utxo(1, 0, 0, 1, false), utxo(2, 1, 0, 2, false), utxo(3, 0, 1, 3, true)];
  assert.deepEqual(spendable(list).map((u) => u.value), [2, 3]);
});

test('RBF: vervangende transactie met hogere fee uit kleiner wisselgeld', () => {
  const utxos = [utxo(100_000, 0, 0, 1)];
  const changeAddr = book.at(1, 0).address;
  const draft = buildSend({ utxos, to: EXTERN, amount: 40_000, feeRate: 2, changeAddress: changeAddr, net: 'test', book });
  const acc = accountKey(ABANDON, '', 'test');
  const signed = signDraft(draft.tx, draft.inputs, acc);
  const raw = Transaction.fromRaw(hex.decode(signed.hex));
  const orig: EsploraTx = {
    txid: signed.txid, version: 2, locktime: 0, weight: raw.weight, fee: draft.fee,
    vin: [{ txid: utxos[0]!.txid, vout: 0, sequence: RBF_SEQUENCE, prevout: { scriptpubkey: hex.encode(book.at(0, 0).script), scriptpubkey_address: book.at(0, 0).address, value: 100_000 } }],
    vout: Array.from({ length: raw.outputsLength }, (_, i) => {
      const o = raw.getOutput(i);
      const script = hex.encode(o.script!);
      const address = script === hex.encode(book.at(1, 0).script) ? changeAddr : EXTERN;
      return { scriptpubkey: script, scriptpubkey_address: address, value: Number(o.amount) };
    }),
    status: { confirmed: false },
  };
  const locate = (a: string | undefined) => (a === changeAddr ? { chain: 1 as const, index: 0 } : a === book.at(0, 0).address ? { chain: 0 as const, index: 0 } : null);

  const summary = summarizeTx(orig, (a) => locate(a) !== null);
  assert.ok(summary.bumpable);
  assert.equal(summary.net, -(40_000 + draft.fee));
  assert.deepEqual(summary.counterparties, [EXTERN]);

  const bump = buildBump(orig, 10, locate, book);
  assert.ok(bump.newFee > bump.oldFee);
  assert.ok(bump.newFee >= bump.oldFee + Math.ceil(orig.weight / 4));
  assert.equal(bump.changeAfter, draft.change!.amount - (bump.newFee - bump.oldFee));
  const bumped = signDraft(bump.tx, bump.inputs, acc);
  acc.wipePrivateData();
  assert.notEqual(bumped.txid, signed.txid);
  const rb = Transaction.fromRaw(hex.decode(bumped.hex));
  const toExtern = Array.from({ length: rb.outputsLength }, (_, i) => rb.getOutput(i)).find((o) => Number(o.amount) === 40_000);
  assert.ok(toExtern, 'ontvanger krijgt nog steeds hetzelfde bedrag');

  assert.throws(() => buildBump({ ...orig, status: { confirmed: true } }, 10, locate, book), /bevestigd/);
  assert.throws(() => buildBump(orig, 100_000, locate, book), /wisselgeld/);
  assert.throws(() => buildBump(orig, 10, () => null, book), /inputs/);
});

test('fee-niveaus uit de fee-estimates', () => {
  assert.deepEqual(feeLevels({ '1': 20.4, '2': 18, '3': 15, '6': 9.2, '144': 1.3, '1008': 1 }), { low: 2, normal: 10, high: 21 });
  assert.deepEqual(feeLevels({}), { low: 1, normal: 1, high: 1 });
});
