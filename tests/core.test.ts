import test from 'node:test';
import assert from 'node:assert/strict';
import { Account, isValidMnemonic, newMnemonic } from '../src/core/wallet.ts';
import { open, seal } from '../src/core/vault.ts';
import { formatBtc, parseBtc } from '../src/core/units.ts';
import { isAddress, makeUri, parseUri } from '../src/core/bip21.ts';
import { buildTx } from '../src/core/send.ts';

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('BIP84 officiële testvector', () => {
  const a = new Account(M, '', 'main');
  assert.equal(a.extendedPublic(), 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs');
  assert.equal(a.address(0, 0), 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  assert.equal(a.address(0, 1), 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g');
  assert.equal(a.address(1, 0), 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el');
  assert.equal(a.wif(0, 0), 'KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d');
});

test('testnet geeft tb1-adressen', () => {
  assert.match(new Account(M, '', 'test').address(0, 0), /^tb1q/);
});

test('seed genereren en controleren', () => {
  const m12 = newMnemonic(12), m24 = newMnemonic(24);
  assert.equal(m12.split(' ').length, 12);
  assert.equal(m24.split(' ').length, 24);
  assert.ok(isValidMnemonic(m12) && isValidMnemonic('  ' + m24.toUpperCase() + ' '));
  assert.ok(!isValidMnemonic(M.replace('about', 'abandon')));
  assert.notEqual(newMnemonic(), newMnemonic());
});

test('passphrase geeft andere wallet', () => {
  assert.notEqual(new Account(M, 'x', 'main').address(0, 0), new Account(M, '', 'main').address(0, 0));
});

test('kluis versleutelt en weigert verkeerd wachtwoord', async () => {
  const v = await seal({ mnemonic: M, passphrase: '' }, 'geheim', 1000);
  assert.ok(!JSON.stringify(v).includes('abandon'));
  assert.equal((await open(v, 'geheim')).mnemonic, M);
  await assert.rejects(open(v, 'fout'));
});

test('bedragen', () => {
  assert.equal(parseBtc('0,001'), 100000n);
  assert.equal(parseBtc('21'), 2100000000n);
  assert.equal(formatBtc(123456789n), '1.23456789');
  assert.equal(formatBtc(100000n), '0.001');
  assert.throws(() => parseBtc('0.000000001'));
});

test('BIP21', () => {
  const a = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
  assert.ok(isAddress(a, 'main') && !isAddress(a, 'test') && !isAddress('bc1qfout', 'main'));
  const u = makeUri(a, 50000n);
  assert.equal(u, `bitcoin:${a}?amount=0.0005`);
  assert.deepEqual(parseUri(u), { address: a, amount: 50000n, label: undefined });
});

test('transactie bouwen en ondertekenen', () => {
  const acc = new Account(M, '', 'main');
  const coins = [{ txid: '11'.repeat(32), vout: 0, value: 100000, chain: 0 as const, index: 0, confirmed: true }];
  const to = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';
  const d = buildTx(acc, coins, to, 30000n, 5, 0);
  assert.equal(d.amount, 30000n);
  assert.equal(d.amount + d.change + d.fee, 100000n);
  assert.ok(d.fee >= BigInt(d.vsize * 5));
  assert.ok(d.tx.hex.length > 100);
  const all = buildTx(acc, coins, to, 'max', 5, 0);
  assert.equal(all.change, 0n);
  assert.equal(all.amount + all.fee, 100000n);
  assert.throws(() => buildTx(acc, coins, to, 99999n, 5, 0));
});

test('Esplora valt terug op reserve-server', async () => {
  const { Esplora, serversFor } = await import('../src/core/esplora.ts');
  assert.deepEqual(serversFor('main', 'https://mempool.space/api/'), ['https://mempool.space/api', 'https://blockstream.info/api']);
  assert.deepEqual(serversFor('main', 'https://eigen.node/api'), ['https://eigen.node/api']);
  const orig = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    if (url.startsWith('https://a')) throw new TypeError('Failed to fetch');
    return new Response('123');
  }) as typeof fetch;
  try {
    const api = new Esplora(['https://a/api', 'https://b/api']);
    assert.equal(await api.tipHeight(), 123);
    assert.equal(api.base, 'https://b/api');
    assert.equal(calls.length, 3);
  } finally { globalThis.fetch = orig; }
});
