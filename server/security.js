const { randomBytes, scrypt: scryptCallback, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(scryptCallback);

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [algorithm, salt, hex] = String(stored).split(':');
  if (algorithm !== 'scrypt' || !salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  if (expected.length !== 64) return false;
  const actual = await scrypt(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

const token = () => randomBytes(32).toString('base64url');
const hashToken = value => createHash('sha256').update(value).digest('hex');
const cleanEmail = value => String(value || '').trim().toLowerCase();
const cleanText = (value, max = 120) => String(value || '').trim().slice(0, max);
// El tope de longitud va antes del regex: con entradas largas el regex retrocede de forma cuadrática.
const validEmail = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validPassword = password => typeof password === 'string' && password.length >= 12 && password.length <= 128;

module.exports = { hashPassword, verifyPassword, token, hashToken, cleanEmail, cleanText, validEmail, validPassword };
