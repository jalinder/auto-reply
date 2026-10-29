'use client';
import { RECIPIENT_STATUS, fmtNum } from '@/lib/status';

const ORDER = ['read', 'delivered', 'submitted', 'queued', 'unknown', 'failed', 'skipped'] as const;
const SWATCH: Record<string, string> = {
  queued: 'var(--muted-seg)', submitted: 'var(--slate-blue)', delivered: 'var(--pine)', read: 'var(--indigo)',
  failed: 'var(--brick)', unknown: 'var(--unknown)', skipped: 'var(--line)',
};

/** Evidence ladder: each recipient sits in exactly one segment, at the highest status we can prove. */
export function Ladder({ counts, big, selected, onSelect }: { counts: Record<string, number> | undefined; big?: boolean; selected?: string | null; onSelect?: (s: string | null) => void }) {
  const c = { ...(counts ?? {}) };
  c.queued = (c.queued ?? 0) + (c.attempting ?? 0);
  c.skipped = (c.skipped ?? 0) + (c.cancelled ?? 0);
  const total = ORDER.reduce((a, k) => a + (c[k] ?? 0), 0);
  return (
    <div>
      <div className={`ladder ${big ? 'big' : ''}`} role="img" aria-label={ORDER.map((k) => `${RECIPIENT_STATUS[k].label} ${c[k] ?? 0}`).join(', ')}>
        {total === 0 ? <span style={{ flexGrow: 1 }} className="queued" /> :
          ORDER.map((k) => (c[k] ?? 0) > 0 && <span key={k} className={k} style={{ flexGrow: c[k] }} title={`${RECIPIENT_STATUS[k].label}: ${c[k]}`} />)}
      </div>
      {big && (
        <div className="ladder-legend">
          {ORDER.map((k) => (
            <button key={k} type="button" aria-pressed={selected === k} onClick={() => onSelect?.(selected === k ? null : k)} title={RECIPIENT_STATUS[k].help}>
              <span className="k"><span className="sw" style={{ background: SWATCH[k] }} />{RECIPIENT_STATUS[k].label}</span>
              <span className="v num">{fmtNum(c[k])}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
