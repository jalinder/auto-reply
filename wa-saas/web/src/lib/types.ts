export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export interface Membership { tenant: { id: string; name: string; slug: string; planId: string }; role: Role }
export interface Me { user: { id: string; email: string; name: string; twoFactorEnabled?: boolean }; memberships: Membership[] }

export type ConnStatus = 'created' | 'waiting_for_qr' | 'linking' | 'connected' | 'qr_expired' | 'disconnected' | 'error' | 'revoked';
export interface Capabilities { qrLinking: boolean; templates: boolean; media: string[]; deliveryReceipts: boolean; readReceipts: boolean; freeformRequiresOpenWindow: boolean }
export interface Connection {
  id: string; label: string; connectorType: 'browser' | 'sandbox'; status: ConnStatus; maskedAccount: string | null;
  connectedAt: string | null; lastSeenAt: string | null; lastErrorCode: string | null; qrExpiresAt: string | null; capabilities: Capabilities | null; createdAt: string;
}
export interface Contact {
  id: string; phone: string; displayName: string | null; customFields: Record<string, string>; tags: string[]; status: string; optedOut: boolean;
  consents: { id: string; purpose: string; source: string; capturedAt: string }[]; createdAt: string;
  history?: { campaignId: string; campaignName: string; status: string; updatedAt: string }[];
}
export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';
export interface Audience { type: 'all' | 'tags' | 'contacts'; tags?: string[]; contactIds?: string[]; requireConsent?: boolean; consentPurpose?: string }
export interface Campaign {
  id: string; name: string; status: CampaignStatus; pausedReason: string | null; connectionId: string;
  connection?: { id: string; label: string; status: ConnStatus; connectorType: string };
  messageType: 'text' | 'template'; body: string | null; templateName: string | null; templateLanguage: string | null; templateParams: string[];
  mediaId: string | null; audience: Audience; scheduledAt: string | null; launchedAt: string | null; completedAt: string | null;
  recipientCount: number; counts?: Record<string, number>; createdAt: string;
}
export interface Preview {
  audience: { selected: number; eligible: number; excluded: { optedOut: number; noConsent: number; blocked: number } };
  placeholders: string[]; samples: { contact: { id: string; displayName: string | null; phone: string }; rendered: string; missing: string[] }[];
  errors: string[]; warnings: string[]; canLaunch: boolean; messagesRemaining: number;
  connection: { id: string; label: string; status: ConnStatus; maskedAccount: string | null };
}
export interface Page<T> { items: T[]; nextCursor: string | null; total?: number }
