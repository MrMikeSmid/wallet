// Esplora-client: nieuwe pogingen bij rate limiting en nette foutmeldingen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Esplora, EsploraError } from '../src/core/esplora.ts';

function client(responses: (Response | 'netwerkfout')[]) {
  const waits: number[] = [];
  let calls = 0;
  const api = new Esplora(
    'https://x/api',
    async () => {
      const r = responses[Math.min(calls++, responses.length - 1)]!;
      if (r === 'netwerkfout') throw new TypeError('Failed to fetch');
      return r.clone();
    },
    1000,
    { retries: 5, baseMs: 2000, sleep: async (ms) => void waits.push(ms) },
  );
  return { api, waits, calls: () => calls };
}

const ok = () => Response.json({ address: 'a', chain_stats: {}, mempool_stats: {} });
const html429 = () => new Response('<html><h1>429 Too Many Requests</h1></html>', { status: 429 });

test('429 zonder CORS (netwerkfout) wordt opnieuw geprobeerd met oplopende wachttijd', async () => {
  const c = client(['netwerkfout', 'netwerkfout', ok()]);
  const r = await c.api.address('a');
  assert.equal(r.address, 'a');
  assert.deepEqual(c.waits, [2000, 4000]);
});

test('429 met antwoord wordt opnieuw geprobeerd', async () => {
  const c = client([html429(), ok()]);
  assert.equal((await c.api.address('a')).address, 'a');
  assert.deepEqual(c.waits, [2000]);
});

test('na alle pogingen een leesbare melding, geen HTML', async () => {
  const c = client([html429()]);
  await assert.rejects(c.api.address('a'), (e: Error) => e instanceof EsploraError && /beperkt/.test(e.message) && !e.message.includes('<'));
  assert.equal(c.calls(), 6);
  const d = client(['netwerkfout']);
  await assert.rejects(d.api.address('a'), /niet bereikbaar/);
});

test('400 wordt niet opnieuw geprobeerd en geeft de servertekst', async () => {
  const c = client([new Response('Invalid Bitcoin address', { status: 400 })]);
  await assert.rejects(c.api.address('a'), /Invalid Bitcoin address/);
  assert.equal(c.calls(), 1);
});

test('broadcast (POST) wordt niet automatisch herhaald', async () => {
  const c = client(['netwerkfout', new Response('txid')]);
  await assert.rejects(c.api.broadcast('00'), /niet bereikbaar/);
  assert.equal(c.calls(), 1);
});
