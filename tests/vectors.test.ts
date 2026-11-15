// Officiële testvectoren: BIP39 (Trezor), BIP32 (vector 1) en BIP84.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { hex } from '@scure/base';
import { WIF } from '@scure/btc-signer';
import {
  AddressBook, accountKey, accountXpubs, createMnemonic, isValidMnemonic, normalizeMnemonic, privateKeyAt, suggestWords,
} from '../src/core/wallet.ts';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('BIP39: entropie → woorden → seed (passphrase TREZOR)', () => {
  const vectors: [string, string, string][] = [
    ['00000000000000000000000000000000', ABANDON,
      'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04'],
    ['7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f', 'legal winner thank year wave sausage worth useful legal winner thank yellow',
      '2e8905819b8723fe2c1d161860e5ee1830318dbf49a83bd451cfb8440c28bd6fa457fe1296106559a3c80937a1c1069be3a3a5bd381ee6260e8d9739fce1f607'],
    ['80808080808080808080808080808080', 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
      'd71de856f81a8acc65e6fc851a38d4d7ec216fd0796d0a6827a3ad6ed5511a30fa280f12eb2e47ed2ac03b5c462a0358d18d69fe4f985ec81778c1b370b652a8'],
    ['ffffffffffffffffffffffffffffffff', 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
      'ac27495480225222079d7be181583751e86f571027b0497b5b5d11218e0a8a13332572917f0f8e5a589620c6f15b11c61dee327651a14c34e18231052e48c069'],
    ['0000000000000000000000000000000000000000000000000000000000000000',
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art',
      'bda85446c68413707090a52022edd26a1c9462295029f2e60cd7c4f2bbd3097170af7a4d73245cafa9c3cca8d561a7c3de6f5d4a10be8ed2a5e608d68f92fcc8'],
  ];
  for (const [entropy, words, seed] of vectors) {
    assert.equal(entropyToMnemonic(hex.decode(entropy), wordlist), words);
    assert.equal(hex.encode(mnemonicToSeedSync(words, 'TREZOR')), seed);
    assert.ok(isValidMnemonic(words));
  }
});

test('BIP39: checksum, normaliseren, genereren en suggesties', () => {
  assert.equal(isValidMnemonic(ABANDON.replace(/about$/, 'abandon')), false);
  assert.equal(isValidMnemonic('abandon about'), false);
  assert.equal(normalizeMnemonic('  Abandon   ABANDON\nabout '), 'abandon abandon about');
  for (const n of [12, 24] as const) {
    const m = createMnemonic(n);
    assert.equal(m.split(' ').length, n);
    assert.ok(isValidMnemonic(m));
  }
  assert.notEqual(createMnemonic(12), createMnemonic(12));
  assert.deepEqual(suggestWords('aba'), ['abandon']);
  assert.deepEqual(suggestWords('zo'), ['zone', 'zoo']);
});

test('BIP32: testvector 1', () => {
  const m = HDKey.fromMasterSeed(hex.decode('000102030405060708090a0b0c0d0e0f'));
  assert.equal(m.publicExtendedKey, 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8');
  assert.equal(m.privateExtendedKey, 'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi');
  assert.equal(m.derive("m/0'/1/2'/2/1000000000").publicExtendedKey,
    'xpub6H1LXWLaKsWFhvm6RVpEL9P4KfRZSW7abD2ttkWP3SSQvnyA8FSVqNTEcYFgJS2UaFcxupHiYkro49S8yGasTvXEYBVPamhGW6cFJodrTHy');
});

test('BIP84: account-zpub, adressen en sleutels (mainnet)', () => {
  const xpubs = accountXpubs(ABANDON, '');
  // De zpub uit BIP84, omgezet naar standaard xpub-versiebytes.
  const b58 = createBase58check(sha256);
  const raw = b58.decode('zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs');
  const asXpub = Uint8Array.from(raw);
  asXpub.set([0x04, 0x88, 0xb2, 0x1e], 0);
  assert.equal(xpubs.main, b58.encode(asXpub));

  const book = new AddressBook(xpubs.main, 'main');
  assert.equal(book.at(0, 0).address, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  assert.equal(book.at(0, 1).address, 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g');
  assert.equal(book.at(1, 0).address, 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el');

  const acc = accountKey(ABANDON, '', 'main');
  const key = privateKeyAt(acc, 0, 0);
  assert.equal(WIF().encode(key), 'KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d');
  acc.wipePrivateData();
});

test('BIP84: testnet-pad m/84\'/1\'/0\' en passphrase geeft andere wallet', () => {
  const xpubs = accountXpubs(ABANDON, '');
  assert.ok(xpubs.test.startsWith('tpub'));
  assert.equal(new AddressBook(xpubs.test, 'test').at(0, 0).address, 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl');
  const withPass = accountXpubs(ABANDON, 'geheim');
  assert.notEqual(withPass.main, xpubs.main);
});
