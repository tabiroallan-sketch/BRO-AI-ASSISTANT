import { describe, expect, it } from 'vitest';
import {
  OutreachError,
  assertCanApprove,
  assertCanEdit,
  assertCanSend,
} from '../../src/sales/outreach.js';
import type { DraftLike } from '../../src/sales/outreach.js';

function makeDraft(overrides: Partial<DraftLike>): DraftLike {
  return {
    id: 'draft-1',
    userId: 'user-1',
    status: 'DRAFT',
    recipientEmail: 'jane@acme.com',
    subject: 'Quick question',
    content: 'Hi Jane, ...',
    ...overrides,
  };
}

describe('outreach draft guards', () => {
  it('allows the owner to approve a DRAFT', () => {
    expect(() => assertCanApprove(makeDraft({}), 'user-1')).not.toThrow();
  });

  it('rejects approval when the draft is not the owner’s', () => {
    expect(() => assertCanApprove(makeDraft({}), 'user-2')).toThrow(OutreachError);
    try {
      assertCanApprove(makeDraft({}), 'user-2');
    } catch (error) {
      expect((error as OutreachError).code).toBe('NOT_FOUND');
    }
  });

  it('rejects approving an already approved draft', () => {
    expect(() => assertCanApprove(makeDraft({ status: 'APPROVED' }), 'user-1')).toThrow(
      OutreachError,
    );
  });

  it('requires APPROVED status before sending', () => {
    expect(() => assertCanSend(makeDraft({ status: 'DRAFT' }), 'user-1')).toThrow(OutreachError);
    expect(() => assertCanSend(makeDraft({ status: 'APPROVED' }), 'user-1')).not.toThrow();
  });

  it('requires a recipient email to send', () => {
    expect(() =>
      assertCanSend(makeDraft({ status: 'APPROVED', recipientEmail: null }), 'user-1'),
    ).toThrow(OutreachError);
  });

  it('only allows editing drafts', () => {
    expect(() => assertCanEdit(makeDraft({}), 'user-1')).not.toThrow();
    expect(() => assertCanEdit(makeDraft({ status: 'APPROVED' }), 'user-1')).toThrow(OutreachError);
    expect(() => assertCanEdit(makeDraft({ status: 'SENT' }), 'user-1')).toThrow(OutreachError);
  });

  it('rejects editing another user’s draft', () => {
    expect(() => assertCanEdit(makeDraft({}), 'user-2')).toThrow(OutreachError);
  });
});
