import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { config } from './config';

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function masterKey(): Buffer {
  const key = Buffer.from(config.secrets.masterKey, 'base64');
  if (key.length !== 32) throw new Error('SECRETS_MASTER_KEY must be 32 bytes (base64)');
  return key;
}

export function encrypt(plaintext: string, aad: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext: ct.toString('base64'), iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
}

export function decrypt(enc: { ciphertext: string; iv: string; tag: string }, aad: string): string {
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(enc.iv, 'hex'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(enc.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(enc.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export function maskPhone(e164: string): string {
  if (e164.length < 6) return '••••';
  return `${e164.slice(0, 3)}••••${e164.slice(-3)}`;
}
