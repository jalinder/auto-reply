process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdef';
process.env.JWT_STEPUP_SECRET = 'test-stepup-secret-0123456789abcdef';
process.env.SECRETS_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');

import { decrypt, encrypt, maskPhone } from './crypto';
import { normalizePhone } from './phone';
import { contactVariables, placeholdersIn, render } from './template';
import { sniffMatches } from '../modules/media/file-signature';
import { csvCell } from '../modules/contacts/spreadsheet';

describe('template rendering', () => {
  const vars = contactVariables({ displayName: 'Asha Rao', phoneE164: '+919812345678', customFields: { city: 'Pune', 'bad key': 'x' } });
  it('renders known placeholders', () => {
    expect(render('Hi {{first_name}} from {{ city }}', vars)).toEqual({ text: 'Hi Asha from Pune', missing: [] });
  });
  it('reports missing placeholders and never executes code', () => {
    const r = render('Hi {{coupon}} {{constructor}}', vars);
    expect(r.missing).toEqual(['coupon', 'constructor']);
  });
  it('ignores unsafe custom field keys', () => {
    expect(vars['bad key']).toBeUndefined();
  });
  it('lists placeholders', () => expect(placeholdersIn('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']));
});

describe('phone normalization', () => {
  it('normalizes Indian numbers to E.164', () => {
    expect(normalizePhone('98123 45678', 'IN')).toBe('+919812345678');
    expect(normalizePhone('0091 98123 45678')).toBe('+919812345678');
  });
  it('rejects invalid numbers', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
  });
  it('masks numbers', () => expect(maskPhone('+919812345678')).toBe('+91••••678'));
});

describe('secret encryption', () => {
  it('round-trips with the same tenant', () => {
    const e = encrypt('token-123', 'tenant:A');
    expect(decrypt(e, 'tenant:A')).toBe('token-123');
  });
  it('fails to decrypt under another tenant (AAD binding)', () => {
    const e = encrypt('token-123', 'tenant:A');
    expect(() => decrypt(e, 'tenant:B')).toThrow();
  });
});

describe('file signatures', () => {
  it('accepts real PNG and rejects a renamed file', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(sniffMatches('image/png', png)).toBe(true);
    expect(sniffMatches('image/png', Buffer.from('%PDF-1.7'))).toBe(false);
    expect(sniffMatches('text/csv', Buffer.from('%PDF-1.7'))).toBe(false);
    expect(sniffMatches('text/csv', Buffer.from('phone,name\n+91,Asha'))).toBe(true);
  });
});

describe('csv export safety', () => {
  it('neutralizes formula injection', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('plain')).toBe('plain');
  });
});
