import { CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';

export function normalizePhone(raw: string, defaultCountry: string = 'IN'): string | null {
  if (!raw) return null;
  const cleaned = String(raw).trim().replace(/[^\d+]/g, '');
  if (cleaned.length < 6) return null;
  const withPlus = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
  const parsed = parsePhoneNumberFromString(withPlus, defaultCountry as CountryCode);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number; // E.164
}
