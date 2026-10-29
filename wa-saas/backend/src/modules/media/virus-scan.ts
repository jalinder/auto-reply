import { connect } from 'net';
import { config } from '../../common/config';

/**
 * Optional malware scan via a clamd sidecar (INSTREAM protocol). Returns null when clean or when
 * scanning is not configured, or the signature name when infected. Throws if clamd is unreachable.
 */
export function scanBuffer(buf: Buffer): Promise<string | null> {
  if (!config.clamav.host) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const sock = connect(config.clamav.port, config.clamav.host);
    let reply = '';
    sock.setTimeout(30_000, () => { sock.destroy(); reject(new Error('clamd timeout')); });
    sock.on('error', reject);
    sock.on('data', (d) => { reply += d.toString(); });
    sock.on('end', () => resolve(parseClamd(reply)));
    sock.on('connect', () => {
      sock.write('zINSTREAM\0');
      for (let i = 0; i < buf.length; i += 64 * 1024) {
        const chunk = buf.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4); len.writeUInt32BE(chunk.length);
        sock.write(len); sock.write(chunk);
      }
      sock.end(Buffer.alloc(4)); // zero-length chunk terminates the stream
    });
  });
}

export function parseClamd(reply: string): string | null {
  const r = reply.replace(/\0/g, '').trim();
  if (/: OK$/.test(r)) return null;
  const m = r.match(/: (.+) FOUND$/);
  if (m) return m[1];
  throw new Error(`clamd error: ${r.slice(0, 120)}`);
}
