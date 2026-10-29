'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { useToast } from '@/components/providers';
import { Button, ErrorNote, Field, Input, PageHead, Select } from '@/components/ui';
import { api, uploadFile } from '@/lib/api';
import { fmtNum } from '@/lib/status';
import { ContactTabs } from '../tabs';

interface PreviewRes { headers: string[]; sampleRows: Record<string, string>[]; suggestedMapping: { phone: string | null; name: string | null; tags: string | null } }
interface ImportRes { id: string; status: string; rowCount: number; createdCount: number; updatedCount: number; invalidCount: number; duplicateCount: number; optedOutCount: number; hasErrorFile: boolean; errorSample: { row: number; phone: string; reason: string }[] }

export default function ImportPage() {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRes | null>(null);
  const [map, setMap] = useState<{ phone: string; name: string; tags: string; fields: Record<string, string> }>({ phone: '', name: '', tags: '', fields: {} });
  const [country, setCountry] = useState('IN');
  const [addTags, setAddTags] = useState('');
  const [consent, setConsent] = useState(false);
  const [source, setSource] = useState('');
  const [importId, setImportId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { data: job } = useSWR<ImportRes>(importId ? `/v1/contacts/imports/${importId}` : null, { refreshInterval: (d) => (d && ['completed', 'failed'].includes(d.status) ? 0 : 2000) });

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null); setBusy(true); setProgress(0);
    try {
      const m = await uploadFile(f, 'import', setProgress);
      setMediaId(m.id);
      const p = await api<PreviewRes>('/v1/contacts/import/preview', { method: 'POST', body: { mediaId: m.id } });
      setPreview(p);
      setMap({ phone: p.suggestedMapping.phone ?? '', name: p.suggestedMapping.name ?? '', tags: p.suggestedMapping.tags ?? '', fields: {} });
      setStep(1);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<ImportRes>('/v1/contacts/import', { method: 'POST', body: {
        mediaId, defaultCountry: country, addTags: addTags.split(',').map((t) => t.trim()).filter(Boolean),
        mapping: { phone: map.phone, name: map.name || undefined, tags: map.tags || undefined, fields: map.fields },
        consent: consent ? { purpose: 'marketing', source: source || 'import' } : undefined,
      } });
      setImportId(r.id); setStep(2);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const downloadErrors = async () => {
    try { const r = await api<{ url: string }>(`/v1/contacts/imports/${importId}/errors`); window.open(r.url, '_blank', 'noopener'); }
    catch (e) { toast((e as Error).message, 'bad'); }
  };

  const unmapped = preview?.headers.filter((h) => ![map.phone, map.name, map.tags].includes(h)) ?? [];
  return (
    <>
      <PageHead title="Contacts" />
      <ContactTabs />
      <div className="wizard" aria-hidden><span className="on" /><span className={step >= 1 ? 'on' : ''} /><span className={step >= 2 ? 'on' : ''} /></div>
      <ErrorNote error={error} />

      {step === 0 && (
        <div className="panel stack">
          <h2>Upload a spreadsheet</h2>
          <p className="muted">CSV or Excel (.xlsx), up to 20 MB and 100,000 rows. The first row must contain column names.</p>
          <label className="btn primary" style={{ alignSelf: 'flex-start' }}>
            {busy ? `Uploading ${progress}%…` : 'Choose file'}
            <input type="file" hidden accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        </div>
      )}

      {step === 1 && preview && (
        <div className="stack">
          <div className="panel stack">
            <h2>Match your columns</h2>
            <div className="grid-3">
              <Field label="Phone number" htmlFor="m-phone"><Select id="m-phone" value={map.phone} onChange={(e) => setMap({ ...map, phone: e.target.value })}><option value="">Choose a column</option>{preview.headers.map((h) => <option key={h}>{h}</option>)}</Select></Field>
              <Field label="Name" htmlFor="m-name"><Select id="m-name" value={map.name} onChange={(e) => setMap({ ...map, name: e.target.value })}><option value="">Don’t import</option>{preview.headers.map((h) => <option key={h}>{h}</option>)}</Select></Field>
              <Field label="Tags" htmlFor="m-tags" hint="Separate multiple tags with | or ,"><Select id="m-tags" value={map.tags} onChange={(e) => setMap({ ...map, tags: e.target.value })}><option value="">Don’t import</option>{preview.headers.map((h) => <option key={h}>{h}</option>)}</Select></Field>
            </div>
            {unmapped.length > 0 && (
              <div className="stack" style={{ gap: 8 }}>
                <h3>Extra columns as personalization fields</h3>
                {unmapped.map((h) => {
                  const key = Object.entries(map.fields).find(([, col]) => col === h)?.[0];
                  return (
                    <label key={h} className="check">
                      <input type="checkbox" checked={!!key} onChange={(e) => {
                        const f = { ...map.fields };
                        if (e.target.checked) f[h.toLowerCase().replace(/[^\w]/g, '_')] = h; else if (key) delete f[key];
                        setMap({ ...map, fields: f });
                      }} />
                      <span>{h} {key && <span className="subtle">→ use as <span className="mono">{`{{${key}}}`}</span></span>}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div className="panel flush table-wrap">
            <table className="table"><thead><tr>{preview.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{preview.sampleRows.map((r, i) => <tr key={i}>{preview.headers.map((h) => <td key={h}>{r[h]}</td>)}</tr>)}</tbody></table>
          </div>
          <div className="panel stack">
            <div className="grid-2">
              <Field label="Default country" htmlFor="cc" hint="Used when a number has no country code."><Select id="cc" value={country} onChange={(e) => setCountry(e.target.value)}>{['IN', 'AE', 'GB', 'US', 'SG', 'SA', 'BD', 'NP', 'LK'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
              <Field label="Add a tag to everyone" htmlFor="at" hint="e.g. diwali-2026"><Input id="at" value={addTags} onChange={(e) => setAddTags(e.target.value)} /></Field>
            </div>
            <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>Everyone in this file agreed to receive marketing messages from us.</span></label>
            {consent && <Field label="How was consent collected?" htmlFor="src" hint="Recorded on each contact, e.g. “website signup form”."><Input id="src" value={source} onChange={(e) => setSource(e.target.value)} /></Field>}
            <div className="row"><Button onClick={() => setStep(0)}>Back</Button><Button variant="primary" disabled={!map.phone || (consent && !source)} loading={busy} onClick={start}>Import contacts</Button></div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="panel stack">
          {!job || !['completed', 'failed'].includes(job.status) ? (
            <div className="row"><span className="spinner" /> Importing… you can leave this page; we’ll keep going.</div>
          ) : job.status === 'failed' ? (
            <div className="callout bad">{job.errorSample[0]?.reason ?? 'The import failed.'}</div>
          ) : (
            <>
              <h2>Import finished</h2>
              <div className="grid-3">
                <div><p className="figure num">{fmtNum(job.createdCount)}</p><p className="muted">new contacts</p></div>
                <div><p className="figure num">{fmtNum(job.updatedCount)}</p><p className="muted">updated</p></div>
                <div><p className="figure num">{fmtNum(job.invalidCount + job.duplicateCount)}</p><p className="muted">skipped rows</p></div>
              </div>
              {job.optedOutCount > 0 && <div className="callout">{fmtNum(job.optedOutCount)} imported numbers are on your opt-out list and won’t receive campaigns.</div>}
              {job.errorSample.length > 0 && (
                <div className="panel flush table-wrap"><table className="table"><thead><tr><th>Row</th><th>Value</th><th>Reason</th></tr></thead>
                  <tbody>{job.errorSample.slice(0, 8).map((e, i) => <tr key={i}><td className="num">{e.row}</td><td>{e.phone}</td><td className="muted">{e.reason}</td></tr>)}</tbody></table></div>
              )}
              <div className="row">{job.hasErrorFile && <Button onClick={downloadErrors}>Download skipped rows</Button>}<Link href="/contacts"><Button variant="primary">View contacts</Button></Link></div>
            </>
          )}
        </div>
      )}
    </>
  );
}
