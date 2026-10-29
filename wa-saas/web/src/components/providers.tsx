'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import useSWR, { SWRConfig, useSWRConfig } from 'swr';
import { api, ApiError, fetcher, registerStepUpHandler } from '@/lib/api';
import type { Me, Membership } from '@/lib/types';
import { Button, Dialog, Field, Input } from './ui';

// ---------- Toasts ----------
type Toast = { id: number; text: string; tone?: 'bad' };
const ToastCtx = createContext<(text: string, tone?: 'bad') => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

// ---------- Workspace ----------
interface WorkspaceCtx { me: Me | undefined; current: Membership | undefined; switchTo: (id: string) => Promise<void>; refreshMe: () => void }
const WsCtx = createContext<WorkspaceCtx>({ me: undefined, current: undefined, switchTo: async () => undefined, refreshMe: () => undefined });
export const useWorkspace = () => useContext(WsCtx);
export function useCan(min: 'viewer' | 'editor' | 'admin' | 'owner') {
  const rank = { viewer: 1, editor: 2, admin: 3, owner: 4 } as const;
  const role = useWorkspace().current?.role ?? 'viewer';
  return rank[role] >= rank[min];
}

// ---------- Realtime ----------
type Listener = (e: { type: string; data: any }) => void;
const RtCtx = createContext<(l: Listener) => () => void>(() => () => undefined);
export const useRealtime = (l: Listener) => {
  const sub = useContext(RtCtx);
  const ref = useRef(l);
  ref.current = l;
  useEffect(() => sub((e) => ref.current(e)), [sub]);
};

function RealtimeBridge({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const listeners = useRef(new Set<Listener>());
  const { mutate } = useSWRConfig();
  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const open = () => {
      es = new EventSource('/api/proxy/v1/events');
      es.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data);
          if (e.type === 'ping') return;
          listeners.current.forEach((l) => l(e));
          const prefix = e.type.startsWith('connection') ? '/v1/connections' : e.type.startsWith('campaign') ? '/v1/campaigns' : e.type.startsWith('import') ? '/v1/contacts/imports' : null;
          if (prefix) mutate((k) => typeof k === 'string' && k.startsWith(prefix));
          if (e.type === 'campaign.progress') mutate('/v1/dashboard');
        } catch { /* ignore malformed */ }
      };
      es.onerror = () => { es?.close(); retry = setTimeout(open, 4000); };
    };
    open();
    return () => { es?.close(); clearTimeout(retry); };
  }, [enabled, mutate]);
  const subscribe = useCallback((l: Listener) => { listeners.current.add(l); return () => { listeners.current.delete(l); }; }, []);
  return <RtCtx.Provider value={subscribe}>{children}</RtCtx.Provider>;
}

// ---------- Step-up (re-enter password for sensitive actions) ----------
function StepUpDialog() {
  const [pending, setPending] = useState<((t: string | null) => void) | null>(null);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    registerStepUpHandler(() => new Promise((resolve) => { setPw(''); setErr(null); setPending(() => resolve); }));
  }, []);
  const close = (t: string | null) => { pending?.(t); setPending(null); };
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ stepUpToken: string }>('/v1/auth/step-up', { method: 'POST', body: { password: pw } });
      close(r.stepUpToken);
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!pending} onClose={() => close(null)} title="Confirm it’s you" description="This action is sensitive. Enter your password to continue."
      footer={<><Button variant="ghost" onClick={() => close(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit} disabled={!pw}>Confirm</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Password" htmlFor="stepup-pw" error={err}>
          <Input id="stepup-pw" type="password" autoComplete="current-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((text: string, tone?: 'bad') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <SWRConfig value={{ fetcher, revalidateOnFocus: true, shouldRetryOnError: (e) => !(e instanceof ApiError) || e.status >= 500 }}>
      <ToastCtx.Provider value={toast}>
        {children}
        <StepUpDialog />
        <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.tone ?? ''}`}>{t.text}</div>)}</div>
      </ToastCtx.Provider>
    </SWRConfig>
  );
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { data: me, mutate } = useSWR<Me>('/v1/me');
  const { data: session, mutate: mutateSession } = useSWR<{ tenantId: string | null }>('/api/session/workspace', (u: string) => fetch(u).then((r) => r.json()));
  const { mutate: globalMutate } = useSWRConfig();
  const current = me?.memberships.find((m) => m.tenant.id === session?.tenantId) ?? undefined;

  const switchTo = useCallback(async (tenantId: string) => {
    await fetch('/api/session/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wasaas' }, body: JSON.stringify({ tenantId }) });
    await mutateSession();
    await globalMutate((k) => typeof k === 'string' && k.startsWith('/v1/') && k !== '/v1/me', undefined, { revalidate: true });
  }, [mutateSession, globalMutate]);

  useEffect(() => {
    if (me && session && !current && me.memberships.length === 1) switchTo(me.memberships[0].tenant.id);
  }, [me, session, current, switchTo]);

  return (
    <WsCtx.Provider value={{ me, current, switchTo, refreshMe: () => mutate() }}>
      <RealtimeBridge enabled={!!current}>{children}</RealtimeBridge>
    </WsCtx.Provider>
  );
}
