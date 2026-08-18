'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  Clock,
  Compass,
  Edit3,
  FileText,
  Loader2,
  Mail,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  approveDraft,
  createDraft,
  deleteDraft,
  generatePitch,
  getNextBestAction,
  listDrafts,
  listLeads,
  sendDraft,
  updateDraft,
  type Draft,
  type Lead,
  type NextBestAction,
} from '@/lib/sales';

function statusColor(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'DRAFT':
      return 'secondary';
    case 'APPROVED':
      return 'default';
    case 'SENT':
      return 'outline';
    case 'REJECTED':
      return 'destructive';
    default:
      return 'secondary';
  }
}

function priorityColor(priority: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (priority) {
    case 'high':
      return 'destructive';
    case 'medium':
      return 'default';
    default:
      return 'secondary';
  }
}

function daysUntil(dateStr: string): number {
  const now = new Date();
  const target = new Date(dateStr);
  return Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
}

function formatDays(dateStr: string): string {
  const days = daysUntil(dateStr);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Today';
  return `in ${days}d`;
}

const PITCH_KINDS = [
  { value: 'COLD_EMAIL', label: 'Cold Email' },
  { value: 'LINKEDIN', label: 'LinkedIn Message' },
  { value: 'FOLLOW_UP', label: 'Follow-up' },
  { value: 'JOB_APPLICATION', label: 'Job Application' },
  { value: 'PROPOSAL', label: 'Proposal Intro' },
];

export default function OutreachPage(): React.JSX.Element {
  const router = useRouter();
  const { user, logout } = useAuth();

  const [followUps, setFollowUps] = React.useState<Array<{ lead: Lead; action?: NextBestAction }>>(
    [],
  );
  const [drafts, setDrafts] = React.useState<Draft[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [pitchKind, setPitchKind] = React.useState('COLD_EMAIL');
  const [pitchCompany, setPitchCompany] = React.useState('');
  const [pitchRecipient, setPitchRecipient] = React.useState('');
  const [pitchOppDesc, setPitchOppDesc] = React.useState('');
  const [pitchTone, setPitchTone] = React.useState('');
  const [pitchContext, setPitchContext] = React.useState('');
  const [generating, setGenerating] = React.useState(false);
  const [generatedSubject, setGeneratedSubject] = React.useState('');
  const [generatedBody, setGeneratedBody] = React.useState('');
  const [savingDraft, setSavingDraft] = React.useState(false);

  const [actionLeadId, setActionLeadId] = React.useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = React.useState<string | null>(null);
  const [editContent, setEditContent] = React.useState('');

  React.useEffect(() => {
    let disposed = false;
    async function load(): Promise<void> {
      try {
        const [leadsResult, draftsResult] = await Promise.all([listLeads(), listDrafts()]);
        if (disposed) return;

        setDrafts(draftsResult);

        const due = leadsResult.filter((lead) => {
          if (lead.status === 'WON' || lead.status === 'LOST') return false;
          if (!lead.nextFollowUpAt) return false;
          return daysUntil(lead.nextFollowUpAt) <= 0;
        });

        const withActions = await Promise.all(
          due.map(async (lead) => {
            try {
              const action = await getNextBestAction(lead.id);
              return { lead, action };
            } catch {
              return { lead };
            }
          }),
        );
        if (!disposed) {
          setFollowUps(withActions);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await logout();
          router.replace('/login');
          return;
        }
        if (!disposed) {
          setError('Failed to load outreach data.');
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    void load();
    return () => {
      disposed = true;
    };
  }, [router, logout]);

  async function handleGetAction(leadId: string): Promise<void> {
    setActionLeadId(leadId);
    setError(null);
    try {
      const action = await getNextBestAction(leadId);
      setFollowUps((prev) =>
        prev.map((item) => (item.lead.id === leadId ? { ...item, action } : item)),
      );
    } catch {
      setError('Failed to get recommendation.');
    }
  }

  async function handleApproveDraft(draftId: string): Promise<void> {
    setError(null);
    try {
      const updated = await approveDraft(draftId);
      setDrafts((prev) => prev.map((d) => (d.id === draftId ? updated : d)));
    } catch {
      setError('Failed to approve draft.');
    }
  }

  async function handleSendDraft(draftId: string): Promise<void> {
    setError(null);
    try {
      const { draft } = await sendDraft(draftId);
      setDrafts((prev) => prev.map((d) => (d.id === draftId ? draft : d)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send draft.');
    }
  }

  async function handleDeleteDraft(draftId: string): Promise<void> {
    setError(null);
    try {
      await deleteDraft(draftId);
      setDrafts((prev) => prev.filter((d) => d.id !== draftId));
    } catch {
      setError('Failed to delete draft.');
    }
  }

  async function handleGeneratePitch(): Promise<void> {
    if (!pitchCompany.trim()) {
      setError('Enter a company name to generate a pitch.');
      return;
    }
    setGenerating(true);
    setError(null);
    setGeneratedSubject('');
    setGeneratedBody('');
    try {
      const result = await generatePitch({
        kind: pitchKind,
        company: pitchCompany.trim(),
        recipientName: pitchRecipient.trim() || undefined,
        opportunityDescription: pitchOppDesc.trim() || undefined,
        tone: pitchTone.trim() || undefined,
        context: pitchContext.trim() || undefined,
      });
      setGeneratedSubject(result.subject);
      setGeneratedBody(result.body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate pitch.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveAsDraft(): Promise<void> {
    if (!generatedBody.trim()) return;
    setSavingDraft(true);
    setError(null);
    try {
      const draft = await createDraft({
        kind: pitchKind,
        channel: pitchKind === 'LINKEDIN' ? 'linkedin' : 'email',
        recipientName: pitchRecipient.trim() || undefined,
        subject: generatedSubject.trim() || undefined,
        content: generatedBody,
      });
      setDrafts((prev) => [draft, ...prev]);
      setGeneratedSubject('');
      setGeneratedBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft.');
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleSaveEdit(draftId: string): Promise<void> {
    setError(null);
    try {
      const updated = await updateDraft(draftId, { content: editContent });
      setDrafts((prev) => prev.map((d) => (d.id === draftId ? updated : d)));
      setEditingDraftId(null);
    } catch {
      setError('Failed to update draft.');
    }
  }

  if (user === null || loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const activeDrafts = drafts.filter((d) => d.status === 'DRAFT');
  const approvedDrafts = drafts.filter((d) => d.status === 'APPROVED');
  const sentDrafts = drafts.filter((d) => d.status === 'SENT');
  const rejectedDrafts = drafts.filter((d) => d.status === 'REJECTED');

  return (
    <div>
      <DashboardPageHeader
        title="Outreach"
        description="Follow up with leads, manage message drafts, and generate new outreach."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" />
                Follow-ups Due
                {followUps.length > 0 && (
                  <Badge variant="destructive" className="ml-auto text-xs">
                    {followUps.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {followUps.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No overdue follow-ups. All leads are on track.
                </p>
              ) : (
                <div className="space-y-3">
                  {followUps.map(({ lead, action }) => (
                    <div key={lead.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">{lead.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {lead.company ?? 'Unknown company'}
                            {lead.status && ` · ${lead.status}`}
                            {lead.nextFollowUpAt && ` · ${formatDays(lead.nextFollowUpAt)}`}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 shrink-0 text-xs"
                          onClick={() => void handleGetAction(lead.id)}
                          disabled={actionLeadId === lead.id}
                        >
                          {actionLeadId === lead.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3" />
                          )}
                          Recommend
                        </Button>
                      </div>
                      {action && (
                        <div className="mt-2 rounded-md bg-accent/50 p-2 text-xs">
                          <p className="font-medium">{action.action}</p>
                          <p className="mt-0.5 text-muted-foreground">{action.why}</p>
                          <div className="mt-1 flex gap-2">
                            <Badge variant={priorityColor(action.priority)} className="text-[10px]">
                              {action.priority}
                            </Badge>
                            <span className="text-muted-foreground">{action.timing}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Drafts
              </CardTitle>
            </CardHeader>
            <CardContent>
              {drafts.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No drafts yet. Generate outreach or create one manually.
                </p>
              ) : (
                <div className="space-y-2">
                  {[
                    { label: 'Drafts', items: activeDrafts },
                    { label: 'Approved', items: approvedDrafts },
                    { label: 'Sent', items: sentDrafts },
                    { label: 'Rejected', items: rejectedDrafts },
                  ].map(
                    (group) =>
                      group.items.length > 0 && (
                        <div key={group.label} className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
                          {group.items.map((draft) => (
                            <div key={draft.id} className="rounded-lg border p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium">
                                      {draft.kind.replace('_', ' ')}
                                    </span>
                                    <Badge
                                      variant={statusColor(draft.status)}
                                      className="text-[10px]"
                                    >
                                      {draft.status}
                                    </Badge>
                                    {draft.recipientName && (
                                      <span className="text-xs text-muted-foreground">
                                        → {draft.recipientName}
                                      </span>
                                    )}
                                  </div>
                                  {draft.subject && (
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                      Re: {draft.subject}
                                    </p>
                                  )}
                                  {editingDraftId === draft.id ? (
                                    <div className="mt-2 space-y-2">
                                      <Textarea
                                        value={editContent}
                                        onChange={(e) => setEditContent(e.target.value)}
                                        rows={4}
                                      />
                                      <div className="flex gap-2">
                                        <Button
                                          size="sm"
                                          className="h-7"
                                          onClick={() => void handleSaveEdit(draft.id)}
                                        >
                                          <Check className="mr-1 h-3 w-3" />
                                          Save
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7"
                                          onClick={() => setEditingDraftId(null)}
                                        >
                                          <X className="mr-1 h-3 w-3" />
                                          Cancel
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                      {draft.content}
                                    </p>
                                  )}
                                </div>
                                {editingDraftId !== draft.id && (
                                  <div className="flex shrink-0 gap-1">
                                    {draft.status === 'DRAFT' && (
                                      <>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 w-7 p-0"
                                          onClick={() => {
                                            setEditingDraftId(draft.id);
                                            setEditContent(draft.content);
                                          }}
                                        >
                                          <Edit3 className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 w-7 p-0"
                                          onClick={() => void handleApproveDraft(draft.id)}
                                        >
                                          <Check className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 w-7 p-0 text-destructive"
                                          onClick={() => void handleDeleteDraft(draft.id)}
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </Button>
                                      </>
                                    )}
                                    {draft.status === 'APPROVED' && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7"
                                        onClick={() => void handleSendDraft(draft.id)}
                                      >
                                        <Send className="mr-1 h-3 w-3" />
                                        Send
                                      </Button>
                                    )}
                                    {draft.status === 'REJECTED' && draft.error && (
                                      <span className="max-w-[120px] truncate text-xs text-destructive">
                                        {draft.error}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ),
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-4 w-4" />
                Generate Outreach
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="pitch-kind" className="text-xs font-medium">
                  Type
                </label>
                <select
                  id="pitch-kind"
                  value={pitchKind}
                  onChange={(e) => setPitchKind(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                >
                  {PITCH_KINDS.map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="pitch-company" className="text-xs font-medium">
                  Company *
                </label>
                <Input
                  id="pitch-company"
                  value={pitchCompany}
                  onChange={(e) => setPitchCompany(e.target.value)}
                  placeholder="Acme Corp"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="pitch-recipient" className="text-xs font-medium">
                  Recipient name
                </label>
                <Input
                  id="pitch-recipient"
                  value={pitchRecipient}
                  onChange={(e) => setPitchRecipient(e.target.value)}
                  placeholder="Jane Smith"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="pitch-opp" className="text-xs font-medium">
                  Opportunity / problem
                </label>
                <Textarea
                  id="pitch-opp"
                  value={pitchOppDesc}
                  onChange={(e) => setPitchOppDesc(e.target.value)}
                  placeholder="They need a booking system rebuilt..."
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="pitch-tone" className="text-xs font-medium">
                  Tone
                </label>
                <Input
                  id="pitch-tone"
                  value={pitchTone}
                  onChange={(e) => setPitchTone(e.target.value)}
                  placeholder="professional, warm, concise"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="pitch-context" className="text-xs font-medium">
                  Extra context
                </label>
                <Textarea
                  id="pitch-context"
                  value={pitchContext}
                  onChange={(e) => setPitchContext(e.target.value)}
                  placeholder="Anything else relevant..."
                  rows={2}
                />
              </div>
              <Button
                className="w-full"
                onClick={() => void handleGeneratePitch()}
                disabled={generating || !pitchCompany.trim()}
              >
                {generating ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Compass className="mr-1 h-4 w-4" />
                )}
                Generate
              </Button>

              {generatedBody && (
                <div className="space-y-2 rounded-lg border p-3">
                  {generatedSubject && (
                    <p className="text-xs font-medium">Subject: {generatedSubject}</p>
                  )}
                  <div className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
                    {generatedBody}
                  </div>
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => void handleSaveAsDraft()}
                    disabled={savingDraft}
                  >
                    {savingDraft ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <FileText className="mr-1 h-3 w-3" />
                    )}
                    Save as Draft
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
