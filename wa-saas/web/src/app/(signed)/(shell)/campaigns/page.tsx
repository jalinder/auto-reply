'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { Ladder } from '@/components/ladder';
import { useCan } from '@/components/providers';
import { Button, Empty, Loading, PageHead, Pill } from '@/components/ui';
import { CAMPAIGN_STATUS, fmtDate, fmtNum } from '@/lib/status';
import type { Campaign, Page } from '@/lib/types';

const FILTERS = [['', 'All'], ['draft', 'Drafts'], ['running', 'Sending'], ['scheduled', 'Scheduled'], ['paused', 'Paused'], ['completed', 'Finished']];

export default function CampaignsPage() {
  const [status, setStatus] = useState('');
  const { data } = useSWR<Page<Campaign>>(`/v1/campaigns?limit=50${status ? `&status=${status}` : ''}`);
  const canEdit = useCan('editor');
  const router = useRouter();
  return (
    <>
      <PageHead title="Campaigns" actions={canEdit && <Link href="/campaigns/new"><Button variant="primary">New campaign</Button></Link>} />
      <div className="row" style={{ marginBottom: 14 }}>
        {FILTERS.map(([v, l]) => <Button key={v} size="sm" variant={status === v ? 'primary' : 'ghost'} onClick={() => setStatus(v)}>{l}</Button>)}
      </div>
      {!data ? <Loading /> : data.items.length === 0 ? (
        <div className="panel"><Empty title="No campaigns here" body="Create a campaign to message contacts who agreed to hear from you." action={canEdit && <Link href="/campaigns/new"><Button variant="primary">New campaign</Button></Link>} /></div>
      ) : (
        <div className="panel flush table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Status</th><th style={{ width: '30%' }}>Outcomes</th><th>Recipients</th><th>Created</th></tr></thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => router.push(`/campaigns/${c.id}`)}>
                  <td><Link href={`/campaigns/${c.id}`}>{c.name}</Link><div className="subtle">{c.connection?.label}</div></td>
                  <td><Pill tone={CAMPAIGN_STATUS[c.status].tone}>{CAMPAIGN_STATUS[c.status].label}</Pill></td>
                  <td>{c.status === 'draft' ? <span className="subtle">Not launched</span> : <Ladder counts={c.counts} />}</td>
                  <td className="num">{fmtNum(c.recipientCount)}</td>
                  <td className="subtle">{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
