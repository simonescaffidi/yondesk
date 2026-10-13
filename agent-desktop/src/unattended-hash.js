'use strict';
/*
 * Hash della password per l'accesso non presidiato.
 * Formato nuovo: "scrypt$N$r$p$<salt hex>$<hash hex>" (scrypt con salt casuale da 16 byte).
 * Formato vecchio (fino a 1.0.3): SHA-256 esadecimale senza salt. Viene ancora accettato
 * e, alla prima verifica riuscita, il chiamante lo risalva nel formato nuovo (needsRehash).
 */
const crypto = require('crypto');

const N = 16384, R = 8, P = 1, KEYLEN = 32;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(password), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${h.toString('hex')}`;
}

function isLegacy(stored) {
  return typeof stored === 'string' && /^[0-9a-f]{64}$/i.test(stored);
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  try {
    if (stored.startsWith('scrypt$')) {
      const [, n, r, p, saltHex, hashHex] = stored.split('$');
      const expected = Buffer.from(hashHex, 'hex');
      const h = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length,
        { N: Number(n), r: Number(r), p: Number(p) });
      return h.length === expected.length && crypto.timingSafeEqual(h, expected);
    }
    if (isLegacy(stored)) {
      const h = crypto.createHash('sha256').update(String(password), 'utf8').digest();
      return crypto.timingSafeEqual(h, Buffer.from(stored, 'hex'));
    }
  } catch { /* formato non valido */ }
  return false;
}

module.exports = { hashPassword, verifyPassword, needsRehash: isLegacy };
