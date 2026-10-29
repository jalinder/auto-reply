process.env.JWT_ACCESS_SECRET = 'x'.repeat(32);
process.env.JWT_STEPUP_SECRET = 'y'.repeat(32);
process.env.SECRETS_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');

import { parseClamd } from '../modules/media/virus-scan';
import { TRANSITIONS } from '../modules/connections/connections.service';
import { JsonLogger } from './json-logger';

describe('virus scan replies', () => {
  it('parses clean, infected and error replies', () => {
    expect(parseClamd('stream: OK\0')).toBeNull();
    expect(parseClamd('stream: Eicar-Test-Signature FOUND\0')).toBe('Eicar-Test-Signature');
    expect(() => parseClamd('INSTREAM size limit exceeded. ERROR')).toThrow();
  });
});

describe('structured logs', () => {
  it('redacts secrets by key and by value', () => {
    const out: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => { out.push(s); return true; };
    try {
      new JsonLogger('test').log({ msg: 'login', password: 'hunter2', qr: '2@abc', header: 'Bearer abc.def.ghi' });
    } finally {
      (process.stdout as any).write = orig;
    }
    const line = JSON.parse(out[0]);
    expect(line.password).toBe('[redacted]');
    expect(line.qr).toBe('[redacted]');
    expect(line.header).toBe('[redacted]');
  });
});

describe('connection state machine', () => {
  it('supports async browser linking and re-linking', () => {
    expect(TRANSITIONS.created).toContain('waiting_for_qr');
    expect(TRANSITIONS.waiting_for_qr).toEqual(expect.arrayContaining(['waiting_for_qr', 'linking', 'qr_expired']));
    expect(TRANSITIONS.qr_expired).toContain('created');
    expect(TRANSITIONS.disconnected).toContain('created');
    expect(TRANSITIONS.revoked).toEqual([]);
  });
});
