'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { hashPassword, verifyPassword, needsRehash } = require('../src/unattended-hash');

test('hash nuovo: salt diverso e verifica corretta', () => {
  const a = hashPassword('segreta123'), b = hashPassword('segreta123');
  assert.notStrictEqual(a, b);
  assert.ok(a.startsWith('scrypt$'));
  assert.ok(verifyPassword('segreta123', a));
  assert.ok(!verifyPassword('sbagliata', a));
  assert.ok(!needsRehash(a));
});

test('formato vecchio SHA-256: verificato e segnalato per la migrazione', () => {
  const legacy = crypto.createHash('sha256').update('segreta123').digest('hex');
  assert.ok(needsRehash(legacy));
  assert.ok(verifyPassword('segreta123', legacy));
  assert.ok(!verifyPassword('altra', legacy));
});

test('valori non validi', () => {
  assert.ok(!verifyPassword('x', null));
  assert.ok(!verifyPassword('x', 'scrypt$rotto'));
});
