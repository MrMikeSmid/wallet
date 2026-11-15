// Bedragen, BIP21, wachttijden, versleuteling en ondertekende berichten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBtc, formatSats, formatSigned, parseAmount, parseBtc, parseSats, shortAddress } from '../src/core/format.ts';
import { makePaymentUri, parsePaymentUri } from '../src/core/bip21.ts';
import { delayAfter, formatWait, shouldWipe } from '../src/core/lockout.ts';
import { PBKDF2_ITERATIONS, deriveKeys, isValidPin, newKdfParams, openJson, sealJson } from '../src/core/vault.ts';
import { messageHash, signMessage, verifyMessage } from '../src/core/message.ts';
import { AddressBook, accountKey, accountXpubs, isValidAddress, privateKeyAt } from '../src/core/wallet.ts';
import { hex } from '@scure/base';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('bedragen weergeven', () => {
  assert.equal(formatBtc(0n), '0,00000000');
  assert.equal(formatBtc(123456n), '0,00123456');
  assert.equal(formatBtc(2_100_000_000_000_000n), '21.000.000,00000000');
  assert.equal(formatBtc(-1n), '−0,00000001');
  assert.equal(formatSats(1234567n), '1.234.567');
  assert.equal(formatSigned(500n, 'sats'), '+500');
  assert.equal(formatSigned(-500n, 'sats'), '−500');
  assert.equal(shortAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'), 'bc1qcr8t…8z306fyu');
});

test('bedragen invoeren', () => {
  assert.equal(parseBtc('0,001'), 100_000n);
  assert.equal(parseBtc('0.001'), 100_000n);
  assert.equal(parseBtc('.5'), 50_000_000n);
  assert.equal(parseBtc('1'), 100_000_000n);
  assert.equal(parseBtc('0,000000001'), null);
  assert.equal(parseBtc('abc'), null);
  assert.equal(parseBtc(''), null);
  assert.equal(parseSats('12.345'), 12_345n);
  assert.equal(parseSats('1,5'), null);
  assert.equal(parseAmount('2', 'btc'), 200_000_000n);
  assert.equal(parseAmount('2', 'sats'), 2n);
});

test('BIP21 lezen en maken', () => {
  assert.deepEqual(parsePaymentUri('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'), { address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu' });
  assert.deepEqual(parsePaymentUri('BITCOIN:bc1qabc?amount=0.0015&label=Peach%20trade&message=Bedankt'), {
    address: 'bc1qabc', amount: 150_000n, label: 'Peach trade', message: 'Bedankt',
  });
  assert.equal(parsePaymentUri('bitcoin:bc1qabc?amount=0,1'), null);
  assert.equal(parsePaymentUri('bitcoin:bc1qabc?req-onbekend=1'), null);
  assert.equal(parsePaymentUri('bitcoin:'), null);
  assert.equal(parsePaymentUri('  '), null);
  assert.equal(makePaymentUri('bc1qabc'), 'bitcoin:bc1qabc');
  assert.equal(makePaymentUri('bc1qabc', 150_000n), 'bitcoin:bc1qabc?amount=0.0015');
  assert.equal(makePaymentUri('bc1qabc', 100_000_000n), 'bitcoin:bc1qabc?amount=1');
});

test('adressen valideren per netwerk', () => {
  assert.ok(isValidAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'main'));
  assert.ok(!isValidAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv', 'main'));
  assert.ok(!isValidAddress('tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl', 'main'));
  assert.ok(isValidAddress('tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl', 'test'));
  assert.ok(isValidAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'main'));
  assert.ok(isValidAddress('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297', 'main'));
});

test('wachttijd na foute pincodes', () => {
  assert.equal(delayAfter(0), 0);
  assert.equal(delayAfter(4), 0);
  assert.equal(delayAfter(5), 30_000);
  assert.equal(delayAfter(6), 60_000);
  assert.equal(delayAfter(7), 120_000);
  assert.equal(delayAfter(30), 3_600_000);
  assert.equal(shouldWipe(10, false), false);
  assert.equal(shouldWipe(9, true), false);
  assert.equal(shouldWipe(10, true), true);
  assert.equal(formatWait(30_000), '30 s');
  assert.equal(formatWait(90_000), '1 min 30 s');
  assert.equal(formatWait(120_000), '2 min');
});

test('pincode-eisen en KDF-instellingen', () => {
  assert.ok(PBKDF2_ITERATIONS >= 600_000);
  assert.equal(newKdfParams().iterations, PBKDF2_ITERATIONS);
  assert.ok(isValidPin('123456'));
  assert.ok(isValidPin('12345678'));
  assert.ok(!isValidPin('12345'));
  assert.ok(!isValidPin('12345a'));
  assert.notEqual(newKdfParams().salt, newKdfParams().salt);
});

test('kluis: versleutelen, ontsleutelen en verkeerde pincode', async () => {
  const params = newKdfParams(1000); // snel in de test
  const keys = await deriveKeys('123456', params);
  const box = await sealJson(keys.vaultKey, { mnemonic: ABANDON, passphrase: '' });
  assert.ok(!box.ct.includes('abandon'));
  assert.deepEqual(await openJson(keys.vaultKey, box), { mnemonic: ABANDON, passphrase: '' });
  // De state-sleutel opent de kluis niet.
  await assert.rejects(openJson(keys.stateKey, box));
  const wrong = await deriveKeys('654321', params);
  await assert.rejects(openJson(wrong.vaultKey, box));
  // Zelfde inhoud geeft elke keer een andere ciphertext (nieuwe IV).
  const box2 = await sealJson(keys.vaultKey, { mnemonic: ABANDON, passphrase: '' });
  assert.notEqual(box.ct, box2.ct);
});

test('bericht ondertekenen en controleren', () => {
  const acc = accountKey(ABANDON, '', 'main');
  const key = privateKeyAt(acc, 0, 0);
  const address = new AddressBook(accountXpubs(ABANDON, '').main, 'main').at(0, 0).address;
  const sig = signMessage(key, 'Ik ben de eigenaar van dit adres');
  assert.equal(sig.length, 88);
  assert.ok(verifyMessage(address, 'Ik ben de eigenaar van dit adres', sig, 'main'));
  assert.ok(!verifyMessage(address, 'Ander bericht', sig, 'main'));
  assert.ok(!verifyMessage('bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g', 'Ik ben de eigenaar van dit adres', sig, 'main'));
  assert.ok(!verifyMessage(address, 'x', 'geen-base64', 'main'));
  // Bekende hash van een leeg bericht.
  assert.equal(hex.encode(messageHash('')), '80e795d4a4caadd7047af389d9f7f220562feb6196032e2131e10563352c4bcc');
  acc.wipePrivateData();
});
