/** Allowlisted media types with magic-byte checks. Extensions and client MIME are never trusted alone. */
export type MediaKind = 'image' | 'document' | 'video' | 'spreadsheet';

export const ALLOWED: Record<string, { kind: MediaKind; purposes: string[] }> = {
  'image/jpeg': { kind: 'image', purposes: ['campaign'] },
  'image/png': { kind: 'image', purposes: ['campaign'] },
  'image/webp': { kind: 'image', purposes: ['campaign'] },
  'application/pdf': { kind: 'document', purposes: ['campaign'] },
  'video/mp4': { kind: 'video', purposes: ['campaign'] },
  'text/csv': { kind: 'spreadsheet', purposes: ['import'] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { kind: 'spreadsheet', purposes: ['import'] },
};

const starts = (b: Buffer, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

export function sniffMatches(mime: string, head: Buffer): boolean {
  switch (mime) {
    case 'image/jpeg': return starts(head, [0xff, 0xd8, 0xff]);
    case 'image/png': return starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp': return starts(head, [0x52, 0x49, 0x46, 0x46]) && starts(head, [0x57, 0x45, 0x42, 0x50], 8);
    case 'application/pdf': return starts(head, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case 'video/mp4': return starts(head, [0x66, 0x74, 0x79, 0x70], 4);
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': return starts(head, [0x50, 0x4b, 0x03, 0x04]);
    case 'text/csv': {
      // Must be valid UTF-8-ish text with no NUL bytes and not a known binary container.
      if (head.includes(0x00)) return false;
      if (starts(head, [0x50, 0x4b]) || starts(head, [0x25, 0x50, 0x44, 0x46])) return false;
      return true;
    }
    default: return false;
  }
}

export function kindOf(mime: string): 'image' | 'document' | 'video' {
  const k = ALLOWED[mime]?.kind;
  return k === 'image' || k === 'video' ? k : 'document';
}
