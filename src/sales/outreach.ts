import { requirePermission } from '../integrations/access.js';
import { fetchWithTimeout } from '../lib/http.js';
import type { DraftStatusValue } from './types.js';

export type DraftLike = {
  id: string;
  userId: string;
  status: DraftStatusValue;
  recipientEmail: string | null;
  subject: string | null;
  content: string;
};

export type OutreachErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_APPROVED'
  | 'NOT_APPROVED'
  | 'ALREADY_SENT'
  | 'NEEDS_EMAIL'
  | 'SEND_FAILED';

export class OutreachError extends Error {
  constructor(
    public readonly code: OutreachErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OutreachError';
  }
}

/**
 * Permission gate: a draft may only be sent after the owner explicitly
 * approved it. Approving requires the current owner; sending requires
 * APPROVED status. Sending never happens automatically.
 */
export function assertCanApprove(draft: DraftLike, userId: string): void {
  if (draft.userId !== userId) {
    throw new OutreachError('NOT_FOUND', 'Draft not found');
  }
  if (draft.status !== 'DRAFT') {
    throw new OutreachError('ALREADY_APPROVED', 'Only drafts can be approved for sending.');
  }
}

export function assertCanSend(draft: DraftLike, userId: string): void {
  if (draft.userId !== userId) {
    throw new OutreachError('NOT_FOUND', 'Draft not found');
  }
  if (draft.status !== 'APPROVED') {
    throw new OutreachError(
      'NOT_APPROVED',
      'This draft has not been approved. Approve it before sending.',
    );
  }
  if (!draft.recipientEmail) {
    throw new OutreachError('NEEDS_EMAIL', 'No recipient email is set on this draft.');
  }
}

export function assertCanEdit(draft: DraftLike, userId: string): void {
  if (draft.userId !== userId) {
    throw new OutreachError('NOT_FOUND', 'Draft not found');
  }
  if (draft.status !== 'DRAFT') {
    throw new OutreachError('ALREADY_APPROVED', 'Approved or sent drafts cannot be edited.');
  }
}

/**
 * Sends an approved email draft through the user's connected Gmail account.
 * Reuses the existing permission system (`gmail.send`) so the Permission
 * Center rules apply. Returns the Gmail message id.
 */
export async function sendEmailDraft(draft: DraftLike, userId: string): Promise<string> {
  assertCanSend(draft, userId);
  const token = await requirePermission(userId, 'google-gmail', 'gmail.send');

  const headers = [
    `To: ${draft.recipientEmail}`,
    `Subject: ${draft.subject ?? '(no subject)'}`,
    'Content-Type: text/plain; charset=UTF-8',
    'MIME-Version: 1.0',
    '',
    draft.content,
  ];
  const raw = Buffer.from(headers.join('\r\n'), 'utf8').toString('base64url');

  const response = await fetchWithTimeout(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      timeoutMs: 10_000,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    },
  );

  if (!response.ok) {
    throw new OutreachError('SEND_FAILED', `Gmail send failed with status ${response.status}`);
  }
  const sent = (await response.json()) as { id?: string };
  return sent.id ?? 'unknown';
}
