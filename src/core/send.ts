import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hex } from '@scure/base';
import { Address, OutScript, selectUTXO, Transaction } from '@scure/btc-signer';
import { network, type Account } from './wallet.ts';

export type Coin = { txid: string; vout: number; value: number; chain: 0 | 1; index: number; confirmed: boolean };
export type Draft = { tx: Transaction; fee: bigint; amount: bigint; change: bigint; vsize: number; inputs: number };

/**
 * Bouwt en ondertekent een transactie. amount = 'max' stuurt alle gekozen munten (minus fee) naar het adres.
 * RBF staat aan (sequence 0xfffffffd), zodat een vastgelopen transactie later versneld kan worden.
 */
export function buildTx(acc: Account, coins: Coin[], to: string, amount: bigint | 'max', feeRate: number, changeIndex: number): Draft {
  if (!coins.length) throw new Error('Geen saldo beschikbaar');
  const net = network(acc.net);
  const inputs = coins.map((c) => ({
    txid: hex.decode(c.txid),
    index: c.vout,
    witnessUtxo: {
      script: OutScript.encode({ type: 'wpkh', hash: ripemd160(sha256(acc.key(c.chain, c.index).publicKey!)) }),
      amount: BigInt(c.value),
    },
    sequence: 0xfffffffd,
  }));
  const max = amount === 'max';
  const changeAddress = max ? to : acc.address(1, changeIndex);
  const sel = selectUTXO(inputs, max ? [] : [{ address: to, amount }], max ? 'all' : 'default', {
    feePerByte: BigInt(Math.max(1, Math.ceil(feeRate))),
    changeAddress,
    network: net,
    bip69: true,
    createTx: true,
  });
  if (!sel || !sel.tx) throw new Error('Onvoldoende saldo voor bedrag plus transactiekosten');
  const tx = sel.tx;
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    const c = coins.find((x) => x.txid === hex.encode(inp.txid!) && x.vout === inp.index)!;
    tx.signIdx(acc.privateKey(c.chain, c.index), i);
  }
  tx.finalize();
  const changeScript = hex.encode(OutScript.encode(Address(net).decode(changeAddress)));
  let sent = 0n;
  let change = 0n;
  for (let i = 0; i < tx.outputsLength; i++) {
    const o = tx.getOutput(i);
    if (!max && hex.encode(o.script!) === changeScript) change += o.amount!;
    else sent += o.amount!;
  }
  return { tx, fee: sel.fee!, amount: sent, change, vsize: tx.vsize, inputs: tx.inputsLength };
}
