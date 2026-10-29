'use client';
import useSWRInfinite from 'swr/infinite';
import { useCan } from '@/components/providers';
import { Button, Empty, Loading } from '@/components/ui';
import { fmtDate } from '@/lib/status';
import type { Page } from '@/lib/types';

interface Log { id: string; action: string; resourceType: string; actor: { name: string; email: string } | null; createdAt: string; metadata: Record<string, unknown> | null }
const LABEL: Record<string, string> = {
  'connection.created': 'Connected a number', 'connection.revoked': 'Removed a number', 'connection.link_cancelled': 'Cancelled number linking',
  'campaign.launched': 'Launched a campaign', 'campaign.paused': 'Paused a campaign', 'campaign.resumed': 'Resumed a campaign', 'campaign.cancelled': 'Cancelled a campaign',
  'contacts.exported': 'Exported contacts', 'contacts.import_started': 'Imported contacts', 'member.invited': 'Invited a teammate', 'member.removed': 'Removed a teammate',
  'member.role_changed': 'Changed a role', 'optout.added': 'Added an opt-out', 'optout.removed': 'Removed an opt-out', 'consent.recorded': 'Recorded consent', 'consent.revoked': 'Revoked consent',
  'tenant.updated': 'Renamed the workspace', 'tenant.created': 'Created the workspace', 'billing.subscribe_started': 'Started a plan change',
};

export default function AuditPage() {
  const canAdmin = useCan('admin');
  const { data, size, setSize, isValidating } = useSWRInfinite<Page<Log>>((i, prev) => (!canAdmin ? null : i === 0 ? '/v1/audit-logs?limit=50' : prev?.nextCursor ? `/v1/audit-logs?limit=50&cursor=${prev.nextCursor}` : null));
  if (!canAdmin) return <div className="panel"><Empty title="Admins only" body="Ask an admin or owner if you need to review workspace activity." /></div>;
  if (!data) return <Loading />;
  const rows = data.flatMap((p) => p.items);
  return (
    <div className="stack">
      <div className="panel flush table-wrap">
        <table className="table">
          <thead><tr><th>What happened</th><th>Who</th><th>When</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{LABEL[r.action] ?? r.action}</td><td>{r.actor?.name ?? <span className="subtle">System</span>}</td><td className="subtle">{fmtDate(r.createdAt)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      {data[data.length - 1]?.nextCursor && <div><Button loading={isValidating} onClick={() => setSize(size + 1)}>Load older activity</Button></div>}
    </div>
  );
}
