'use client';
import useSWR from 'swr';
import { Loading } from '@/components/ui';
import type { Campaign } from '@/lib/types';
import { CampaignBuilder } from '../../builder';
export default function EditCampaign({ params }: { params: { id: string } }) {
  const { data } = useSWR<Campaign>(`/v1/campaigns/${params.id}`);
  return data ? <CampaignBuilder existing={data} /> : <Loading />;
}
