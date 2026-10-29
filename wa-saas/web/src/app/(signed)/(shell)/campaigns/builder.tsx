'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useToast } from '@/components/providers';
import { Button, ErrorNote, Field, Input, PageHead, Select, Textarea } from '@/components/ui';
import { api, uploadFile } from '@/lib/api';
import { CONNECTOR_NAMES } from '@/lib/status';
import type { Audience, Campaign, Connection } from '@/lib/types';

interface Template { name: string; language: string; status: string; category: string; bodyText: string; headerFormat: string | null; paramCount: number }
const BUILTIN = ['first_name', 'name', 'phone'];

export function CampaignBuilder({ existing }: { existing?: Campaign }) {
  const router = useRouter();
  const toast = useToast();
  const { data: conns } = useSWR<{ items: Connection[] }>('/v1/connections');
  const { data: tags } = useSWR<{ items: { tag: string; count: number }[] }>('/v1/contacts/tags');
  const [name, setName] = useState(existing?.name ?? '');
  const [connectionId, setConnectionId] = useState(existing?.connectionId ?? '');
  const [audience, setAudience] = useState<Audience>(existing?.audience ?? { type: 'all', requireConsent: true, consentPurpose: 'marketing' });
  const [messageType, setMessageType] = useState<'text' | 'template'>(existing?.messageType ?? 'text');
  const [body, setBody] = useState(existing?.body ?? 'Hi {{first_name}}, ');
  const [template, setTemplate] = useState<{ name: string; language: string } | null>(existing?.templateName ? { name: existing.templateName, language: existing.templateLanguage ?? 'en' } : null);
  const [params, setParams] = useState<string[]>(existing?.templateParams ?? []);
  const [media, setMedia] = useState<{ id: string; fileName: string } | null>(existing?.mediaId ? { id: existing.mediaId, fileName: 'Attached file' } : null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [when, setWhen] = useState<'now' | 'later'>(existing?.scheduledAt ? 'later' : 'now');
  const [scheduledAt, setScheduledAt] = useState(existing?.scheduledAt ? existing.scheduledAt.slice(0, 16) : '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const usable = (conns?.items ?? []).filter((c) => c.status !== 'revoked');
  const conn = usable.find((c) => c.id === connectionId);
  const { data: templates } = useSWR<{ items: Template[] }>(conn?.capabilities?.templates && conn.status === 'connected' ? `/v1/connections/${conn.id}/templates` : null);
  const approved = (templates?.items ?? []).filter((t) => t.status === 'APPROVED');
  const chosen = approved.find((t) => t.name === template?.name && t.language === template?.language);

  const insert = (key: string) => {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) return setBody(body + token);
    const s = el.selectionStart, e = el.selectionEnd;
    setBody(body.slice(0, s) + token + body.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  };

  const onMedia = async (f: File | undefined) => {
    if (!f) return;
    setUploadPct(0);
    try { const m = await uploadFile(f, 'campaign', setUploadPct); setMedia({ id: m.id, fileName: m.fileName }); }
    catch (e) { toast((e as Error).message, 'bad'); } finally { setUploadPct(null); }
  };

  const previewText = useMemo(() => {
    const sample: Record<string, string> = { first_name: 'Asha', name: 'Asha Rao', phone: '+91 98•••678' };
    const src = messageType === 'template' ? (chosen?.bodyText ?? '').replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] || `{{${n}}}`) : body;
    return src.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => sample[k] ?? m);
  }, [body, messageType, chosen, params]);

  const save = async () => {
    setBusy(true); setError(null);
    const payload = {
      name, connectionId, audience, messageType,
      body: messageType === 'text' ? body : undefined,
      templateName: messageType === 'template' ? template?.name : undefined,
      templateLanguage: messageType === 'template' ? template?.language : undefined,
      templateParams: messageType === 'template' ? params : undefined,
      mediaId: media?.id ?? null,
      scheduledAt: when === 'later' && scheduledAt ? new Date(scheduledAt).toISOString() : null,
    };
    try {
      const c = await api<Campaign>(existing ? `/v1/campaigns/${existing.id}` : '/v1/campaigns', { method: existing ? 'PATCH' : 'POST', body: payload });
      toast('Draft saved.');
      router.push(`/campaigns/${c.id}`);
    } catch (e) { setError(e); setBusy(false); }
  };

  const valid = name.trim() && connectionId && (messageType === 'text' ? body.trim() : !!template) && (audience.type !== 'tags' || (audience.tags?.length ?? 0) > 0) && (when === 'now' || scheduledAt);

  return (
    <>
      <PageHead title={existing ? 'Edit campaign' : 'New campaign'} sub="Saved as a draft. You’ll preview real messages and confirm before anything is sent." />
      <ErrorNote error={error} />
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', alignItems: 'start' }}>
        <div className="stack">
          <section className="panel stack">
            <h2>Basics</h2>
            <Field label="Campaign name" htmlFor="cn" hint="Only your team sees this."><Input id="cn" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Send from" htmlFor="cc">
              <Select id="cc" value={connectionId} onChange={(e) => { setConnectionId(e.target.value); setTemplate(null); }}>
                <option value="">Choose a number</option>
                {usable.map((c) => <option key={c.id} value={c.id}>{c.label} — {CONNECTOR_NAMES[c.connectorType]}{c.status !== 'connected' ? ' (not connected)' : ''}</option>)}
              </Select>
            </Field>
          </section>

          <section className="panel stack">
            <h2>Who gets it</h2>
            <div className="choice-grid">
              <button type="button" className="choice" aria-pressed={audience.type === 'all'} onClick={() => setAudience({ ...audience, type: 'all' })}><strong>All contacts</strong></button>
              <button type="button" className="choice" aria-pressed={audience.type === 'tags'} onClick={() => setAudience({ ...audience, type: 'tags', tags: audience.tags ?? [] })}><strong>Contacts with tags</strong></button>
            </div>
            {audience.type === 'tags' && (
              <div className="row">
                {(tags?.items ?? []).map((t) => {
                  const on = audience.tags?.includes(t.tag);
                  return <button key={t.tag} type="button" className={`btn sm ${on ? 'primary' : 'secondary'}`} aria-pressed={on}
                    onClick={() => setAudience({ ...audience, tags: on ? audience.tags!.filter((x) => x !== t.tag) : [...(audience.tags ?? []), t.tag] })}>{t.tag} · {t.count}</button>;
                })}
                {tags?.items.length === 0 && <p className="muted">No tags yet. Add tags to contacts or during import.</p>}
              </div>
            )}
            <label className="check"><input type="checkbox" checked={audience.requireConsent !== false} onChange={(e) => setAudience({ ...audience, requireConsent: e.target.checked })} />
              <span>Only people with recorded marketing consent <span className="subtle">(recommended)</span></span></label>
            <p className="subtle">Opted-out numbers are always excluded.</p>
          </section>

          <section className="panel stack">
            <h2>Message</h2>
            {conn?.capabilities?.templates && (
              <div className="choice-grid">
                <button type="button" className="choice" aria-pressed={messageType === 'template'} onClick={() => setMessageType('template')}><strong>Approved template</strong><p className="subtle">Required for marketing outside a 24-hour chat window.</p></button>
                <button type="button" className="choice" aria-pressed={messageType === 'text'} onClick={() => setMessageType('text')}><strong>Free-form text</strong><p className="subtle">Only reaches people who messaged you in the last 24 hours.</p></button>
              </div>
            )}
            {messageType === 'text' || !conn?.capabilities?.templates ? (
              <>
                <Field label="Text" htmlFor="body" hint={`${body.length} / 4096`}>
                  <Textarea id="body" ref={bodyRef} maxLength={4096} value={body} onChange={(e) => setBody(e.target.value)} />
                </Field>
                <div className="row"><span className="subtle">Insert:</span>{BUILTIN.map((k) => <Button key={k} size="sm" variant="ghost" onClick={() => insert(k)}>{`{{${k}}}`}</Button>)}</div>
              </>
            ) : (
              <>
                <Field label="Template" htmlFor="tpl" hint={templates && approved.length === 0 ? 'No approved templates. Create one in Meta Business Manager.' : undefined}>
                  <Select id="tpl" value={template ? `${template.name}|${template.language}` : ''} onChange={(e) => {
                    const [n, l] = e.target.value.split('|'); const t = approved.find((x) => x.name === n && x.language === l);
                    setTemplate(n ? { name: n, language: l } : null); setParams(Array.from({ length: t?.paramCount ?? 0 }, (_, i) => params[i] ?? (i === 0 ? '{{first_name}}' : '')));
                  }}>
                    <option value="">Choose a template</option>
                    {approved.map((t) => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language}) · {t.category.toLowerCase()}</option>)}
                  </Select>
                </Field>
                {params.map((p, i) => (
                  <Field key={i} label={`Variable {{${i + 1}}}`} htmlFor={`p${i}`} hint="Text or a placeholder like {{first_name}}">
                    <Input id={`p${i}`} value={p} onChange={(e) => setParams(params.map((x, j) => (j === i ? e.target.value : x)))} />
                  </Field>
                ))}
              </>
            )}
            {(conn?.capabilities?.media?.length ?? 0) > 0 && (
              <div className="row">
                {media ? <><span className="tag">{media.fileName}</span><Button size="sm" variant="ghost" onClick={() => setMedia(null)}>Remove attachment</Button></> : (
                  <label className="btn secondary sm">{uploadPct !== null ? `Uploading ${uploadPct}%…` : 'Attach image or PDF'}
                    <input type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4" onChange={(e) => onMedia(e.target.files?.[0])} /></label>
                )}
              </div>
            )}
          </section>

          <section className="panel stack">
            <h2>When</h2>
            <div className="choice-grid">
              <button type="button" className="choice" aria-pressed={when === 'now'} onClick={() => setWhen('now')}><strong>Right after I confirm</strong></button>
              <button type="button" className="choice" aria-pressed={when === 'later'} onClick={() => setWhen('later')}><strong>At a scheduled time</strong></button>
            </div>
            {when === 'later' && <Field label="Send at" htmlFor="at" hint="Your local time."><Input id="at" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></Field>}
          </section>

          <div className="row"><Button variant="primary" loading={busy} disabled={!valid} onClick={save}>Save and preview</Button><Button variant="ghost" onClick={() => router.back()}>Cancel</Button></div>
        </div>

        <aside className="phone-preview" style={{ position: 'sticky', top: 24 }} aria-label="Message preview">
          <p className="subtle" style={{ marginBottom: 8 }}>Preview with sample contact “Asha”</p>
          {media && <div className="bubble" style={{ marginBottom: 6 }}>📎 {media.fileName}</div>}
          <div className="bubble">{previewText || <span className="subtle">Your message appears here.</span>}</div>
        </aside>
      </div>
    </>
  );
}
