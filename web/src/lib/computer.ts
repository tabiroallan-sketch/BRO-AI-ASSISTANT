import { request } from '@/lib/api';
import { getAccessToken } from '@/lib/token-store';

export type SystemToolInfo = {
  name: string;
  description: string;
  requireConfirmation: boolean;
};

export type PendingAction = {
  id: string;
  userId: string;
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  decidedAt?: string;
  result?: string;
};

export type SystemActionsResponse = {
  actions: PendingAction[];
  tools: SystemToolInfo[];
};

function authToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  return token;
}

export async function listSystemActions(limit?: number): Promise<SystemActionsResponse> {
  const query = limit ? `?limit=${limit}` : '';
  return request<SystemActionsResponse>(`/system/actions${query}`, { token: authToken() });
}

export async function decideAction(
  id: string,
  decision: 'approve' | 'reject',
): Promise<PendingAction> {
  const result = await request<{ action: PendingAction }>(
    `/system/actions/${encodeURIComponent(id)}/decision`,
    { method: 'POST', body: { decision }, token: authToken() },
  );
  return result.action;
}
