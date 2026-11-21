'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { idForKey } = require('../src/signaling');

test('ID del dispositivo: stabile per la stessa chiave, senza dati salvati', () => {
  const a = idForKey('chiave-dispositivo-uno-0123456789');
  assert.match(a, /^[1-9]\d{8}$/);
  assert.equal(idForKey('chiave-dispositivo-uno-0123456789'), a);
  assert.equal(a, '639119408'); // valore fisso: non deve cambiare tra versioni del server
});

test('ID del dispositivo: chiavi diverse, ID diversi', () => {
  const ids = new Set();
  for (let i = 0; i < 2000; i++) ids.add(idForKey('chiave-di-prova-numero-' + i));
  assert.equal(ids.size, 2000);
});

test('ID del dispositivo: senza chiave valida viene assegnato un ID temporaneo', () => {
  assert.match(idForKey(''), /^\d{9}$/);
  assert.notEqual(idForKey('corta'), idForKey('corta'));
});
