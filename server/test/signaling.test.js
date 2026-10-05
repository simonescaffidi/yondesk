'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { server } = require('../src/index');
const WebSocket = require('ws');

function connect(url) {
  return new Promise((res) => { const ws = new WebSocket(url); ws.on('open', () => res(ws)); });
}
function next(ws) {
  return new Promise((res) => ws.once('message', (d) => res(JSON.parse(d))));
}

test('flusso completo di signaling con consenso', async (t) => {
  await new Promise((r) => server.listen(0, r));
  const url = `ws://localhost:${server.address().port}/ws`;

  const host = await connect(url);
  const viewer = await connect(url);

  // register host
  host.send(JSON.stringify({ type: 'register', name: 'PC', platform: 'web', deviceKey: 'k'.repeat(20) }));
  const reg = await next(host);
  assert.equal(reg.type, 'registered');
  assert.match(reg.id, /^\d{9}$/);

  // viewer connect con password
  viewer.send(JSON.stringify({ type: 'connect', target: reg.id, password: 'segreta', name: 'Op' }));
  const pending = await next(viewer);
  assert.equal(pending.type, 'pending');
  const incoming = await next(host);
  assert.equal(incoming.type, 'incoming');
  assert.equal(incoming.password, 'segreta'); // la verifica password è lato host, non lato server

  // host accetta
  host.send(JSON.stringify({ type: 'accept', sessionId: incoming.sessionId, mode: 'control' }));
  const accepted = await next(viewer);
  assert.equal(accepted.type, 'accepted');
  assert.equal(accepted.mode, 'control');

  // relay di signaling
  viewer.send(JSON.stringify({ type: 'signal', sessionId: incoming.sessionId, data: { description: { type: 'offer' } } }));
  const relayed = await next(host);
  assert.equal(relayed.type, 'signal');
  assert.equal(relayed.data.description.type, 'offer');

  // hangup
  viewer.send(JSON.stringify({ type: 'hangup', sessionId: incoming.sessionId }));
  const bye = await next(host);
  assert.equal(bye.type, 'hangup');

  host.close(); viewer.close();
  await new Promise((r) => server.close(r));
});

test('host inesistente -> errore offline', async (t) => {
  await new Promise((r) => server.listen(0, r));
  const url = `ws://localhost:${server.address().port}/ws`;
  const viewer = await connect(url);
  viewer.send(JSON.stringify({ type: 'connect', target: '000000000', password: 'x' }));
  const err = await next(viewer);
  assert.equal(err.type, 'error');
  assert.equal(err.code, 'offline');
  viewer.close();
  await new Promise((r) => server.close(r));
});
