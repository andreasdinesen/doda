/* Integrationstest af MCP-serveren. Koerer mod en rigtig server over HTTP,
   praecis som Claude Code ville. Koer: node --test tests/mcp.test.mjs */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8934;
const BASE = `http://127.0.0.1:${PORT}`;

let server;
let dataDir;
let cookie = '';
const noegler = {};

const api = async (sti, krop, metode) => {
  const r = await fetch(BASE + sti, {
    method: metode || (krop === undefined ? 'GET' : 'POST'),
    headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { cookie } : {}),
    body: krop === undefined ? undefined : JSON.stringify(krop),
  });
  const s = r.headers.get('set-cookie');
  if (s) cookie = s.split(';')[0];
  return r.json();
};

let id = 0;
/** Ét JSON-RPC-kald, uden cookie - som en rigtig MCP-klient. */
const rpc = async (method, params, noegle) => {
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    credentials: 'omit',
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      noegle === null ? {} : { Authorization: `Bearer ${noegle || noegler.full}` },
    ),
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  return { status: r.status, krop: r.status === 202 ? null : await r.json() };
};

const kald = async (navn, args, noegle) => {
  const r = await rpc('tools/call', { name: navn, arguments: args || {} }, noegle);
  return r.krop.result;
};

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'doda-mcp-'));
  server = spawn('node', [join(ROD, 'app', 'server.js')], {
    env: Object.assign({}, process.env, { BIND_PORT: String(PORT), DATA_DIR: dataDir, TZ: 'Europe/Copenhagen' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((ok, fejl) => {
    const timer = setTimeout(() => fejl(new Error('serveren startede ikke')), 10000);
    server.stdout.on('data', (b) => { if (String(b).includes('doda lytter')) { clearTimeout(timer); ok(); } });
    server.stderr.on('data', (b) => process.stderr.write(b));
  });
  await api('/api/register', { username: 'test', password: 'testtest123' });
  for (const scope of ['capture', 'read', 'full']) {
    noegler[scope] = (await api('/api/v1/tokens', { name: `mcp ${scope}`, scope })).key;
  }
});

after(() => {
  if (server) server.kill('SIGTERM');
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------ protokol */

test('initialize svarer med protokolversion og serverinfo', async () => {
  const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(r.status, 200);
  assert.equal(r.krop.jsonrpc, '2.0');
  assert.equal(r.krop.result.protocolVersion, '2025-06-18');
  assert.equal(r.krop.result.serverInfo.name, 'doda');
  assert.ok(r.krop.result.capabilities.tools);
  assert.match(r.krop.result.instructions, /GTD/);
});

test('en ældre protokolversion accepteres, ukendt falder tilbage', async () => {
  assert.equal((await rpc('initialize', { protocolVersion: '2024-11-05' })).krop.result.protocolVersion, '2024-11-05');
  assert.equal((await rpc('initialize', { protocolVersion: '1999-01-01' })).krop.result.protocolVersion, '2025-06-18');
});

test('notifikationer kvitteres med 202 og ingen krop', async () => {
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${noegler.full}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(r.status, 202);
  assert.equal((await r.text()).length, 0);
});

test('ping virker', async () => {
  assert.deepEqual((await rpc('ping')).krop.result, {});
});

test('ukendt metode giver -32601, ugyldig forespørgsel -32600', async () => {
  assert.equal((await rpc('does/not/exist')).krop.error.code, -32601);
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${noegler.full}` },
    body: JSON.stringify({ jsonrpc: '1.0', id: 99, method: 'ping' }),
  });
  assert.equal((await r.json()).error.code, -32600);
});

test('batch besvares som batch', async () => {
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${noegler.full}` },
    body: JSON.stringify([
      { jsonrpc: '2.0', id: 'a', method: 'ping' },
      { jsonrpc: '2.0', id: 'b', method: 'ping' },
    ]),
  });
  const krop = await r.json();
  assert.ok(Array.isArray(krop));
  assert.deepEqual(krop.map((x) => x.id), ['a', 'b']);
});

/* ------------------------------------------------------------- adgang */

test('uden nøgle: 401 med WWW-Authenticate', async () => {
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate') || '', /Bearer/);
});

test('ugyldig nøgle afvises', async () => {
  const r = await rpc('ping', {}, 'doda_findesikke');
  assert.equal(r.status, 401);
});

test('GET og DELETE afvises med 405', async () => {
  for (const metode of ['GET', 'DELETE']) {
    const r = await fetch(`${BASE}/mcp`, { method: metode, headers: { Authorization: `Bearer ${noegler.full}` } });
    assert.equal(r.status, 405, metode);
  }
});

test('fremmed Origin afvises (DNS-rebinding)', async () => {
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${noegler.full}`, Origin: 'https://evil.example' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  assert.equal(r.status, 403);
});

test('tools/list viser KUN det, nøglens scope tillader', async () => {
  const fuld = (await rpc('tools/list', {}, noegler.full)).krop.result.tools.map((t) => t.name);
  const laes = (await rpc('tools/list', {}, noegler.read)).krop.result.tools.map((t) => t.name);
  const fang = (await rpc('tools/list', {}, noegler.capture)).krop.result.tools.map((t) => t.name);

  assert.ok(fuld.includes('capture') && fuld.includes('list_next_actions') && fuld.includes('complete_task'));
  assert.ok(laes.includes('list_next_actions'));
  assert.ok(!laes.includes('capture'), 'en læse-nøgle må ikke få fangst-værktøjet');
  assert.ok(!laes.includes('complete_task'));
  assert.deepEqual(fang, ['capture'], 'en fangst-nøgle ser præcis ét værktøj');

  for (const t of (await rpc('tools/list')).krop.result.tools) {
    assert.ok(t.description && t.description.length > 20, `${t.name} mangler beskrivelse`);
    assert.equal(t.inputSchema.type, 'object');
  }
});

test('scope håndhæves også ved direkte kald, ikke kun i listen', async () => {
  // En fangst-noegle kender maaske navnet alligevel og proever.
  const r = await kald('list_next_actions', {}, noegler.capture);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /cannot read/);
});

/* --------------------------------------------------------- vaerktoejer */

test('capture forstår hele genvejssyntaksen', async () => {
  const r = await kald('capture', { text: 'call the dentist #phone @Health !tomorrow at 9 // remember the referral' });
  assert.equal(r.isError, undefined);
  assert.match(r.content[0].text, /Captured: call the dentist/);
  assert.match(r.content[0].text, /#phone/);
  assert.equal(r.structuredContent.item.due_time, '09:00');
  assert.equal(r.structuredContent.item.note, 'remember the referral');
});

test('capture opretter en gentagelse og skriver reglen ud', async () => {
  const r = await kald('capture', { text: 'water the plants !every! 3 days' });
  assert.match(r.content[0].text, /Repeats: every 3 days · from completion/);
  assert.ok(r.structuredContent.recurrence);
});

test('list_next_actions og filtrering på kontekst', async () => {
  // Fangst lander i INBOX, ikke i naeste-listen - det er hele pointen med
  // en inbox. Den skal afklares foerst.
  const c = await kald('capture', { text: 'buy milk #errands' });
  assert.equal(c.structuredContent.item.status, 'inbox');
  assert.ok(!(await kald('list_next_actions', {})).content[0].text.includes('buy milk'),
    'ufordoejet fangst maa ikke dukke op i naeste-listen');

  await kald('update_task', { id: c.structuredContent.item.id, status: 'next' });
  const alle = await kald('list_next_actions', {});
  assert.ok(alle.structuredContent.items.length >= 1);

  const r = await kald('list_next_actions', { context: 'errands' });
  assert.ok(r.content[0].text.includes('buy milk'));

  const fejl = await kald('list_next_actions', { context: 'nope' });
  assert.equal(fejl.isError, true);
  assert.match(fejl.content[0].text, /No context called "nope"/);
  assert.match(fejl.content[0].text, /Known:/, 'fejlen skal vise, hvad der FINDES');
});

test('complete_task fuldfører og fortsætter gentagelsen', async () => {
  const c = await kald('capture', { text: 'take out bins !every! 2 days' });
  const foer = c.structuredContent.item.id;
  const r = await kald('complete_task', { id: foer });
  assert.match(r.content[0].text, /Done: take out bins/);
  assert.match(r.content[0].text, /Next occurrence:/);

  const igen = await kald('complete_task', { id: foer });
  assert.match(igen.content[0].text, /Already done/, 'genafsendelse maa ikke lave ravage');
});

test('search finder også i beskrivelsen', async () => {
  const r = await kald('search', { query: 'referral' });
  assert.match(r.content[0].text, /call the dentist/);
});

test('update_task ændrer felter', async () => {
  const c = await kald('capture', { text: 'a task to change' });
  const r = await kald('update_task', { id: c.structuredContent.item.id, status: 'someday', title: 'changed' });
  assert.match(r.content[0].text, /Updated: changed \(someday\)/);
});

test('list_projects markerer projekter uden næste handling', async () => {
  await kald('capture', { text: 'first step @Renovation' });
  const r = await kald('list_projects', {});
  assert.match(r.content[0].text, /Renovation/);
  assert.match(r.content[0].text, /NO NEXT ACTION/);
});

test('get_project virker med både id og navn', async () => {
  const viaNavn = await kald('get_project', { id: 'Renovation' });
  assert.match(viaNavn.content[0].text, /# Renovation/);
  const id = viaNavn.structuredContent.project.id;
  assert.match((await kald('get_project', { id })).content[0].text, /# Renovation/);
  const ingen = await kald('get_project', { id: 'Nonexistent' });
  assert.equal(ingen.isError, true);
});

test('list_repeating viser regel, forfald og spring', async () => {
  const r = await kald('list_repeating', {});
  assert.match(r.content[0].text, /water the plants/);
  assert.match(r.content[0].text, /from completion/);
});

test('ukendt værktøj giver -32602', async () => {
  const r = await rpc('tools/call', { name: 'nope', arguments: {} });
  assert.equal(r.krop.error.code, -32602);
});

test('en fejl i et værktøj er isError, ikke en protokolfejl', async () => {
  const r = await kald('complete_task', { id: 'findesikke' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /No item with id/);
});
