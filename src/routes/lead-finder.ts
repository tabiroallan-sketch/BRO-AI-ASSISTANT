import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma as prismaClient } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { recordAudit, type AuditAction } from '../lib/audit.js';
import { notify } from '../lib/notifications.js';
import {
  searchProviders,
  combineResults,
  deduplicateLeads,
  enrichLead,
  scoreLead,
  parseSearchQuery,
  generateOutreach,
  generateMultiChannelOutreach,
  getProviderStatuses,
  type LeadEnrichment,
  type LeadSearchParams,
  type LeadSource,
} from '../lead-finder/index.js';
import type { RawLead, DedupedLead } from '../lead-finder/index.js';

function requireUserId(request: { user?: { id?: string } }): string {
  const userId = request.user?.id;
  if (!userId) {
    throw new Error('Unauthorized');
  }
  return userId;
}

function getDb(): PrismaNonNullable {
  if (!prismaClient) {
    throw new Error('Database not configured');
  }
  return prismaClient;
}

type PrismaNonNullable = NonNullable<typeof prismaClient>;

const searchSchema = z.object({
  query: z.string().min(1),
  sources: z.array(z.string()).optional(),
  industry: z.string().optional(),
  location: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  employeeCountMin: z.number().optional(),
  employeeCountMax: z.number().optional(),
  ratingMin: z.number().optional(),
  ratingMax: z.number().optional(),
  keywords: z.array(z.string()).optional(),
  hiringSignals: z.boolean().optional(),
  intentSignals: z.boolean().optional(),
  limit: z.number().min(1).max(100).optional(),
  enrich: z.boolean().optional(),
  parseNatural: z.boolean().optional(),
});

const enrichSchema = z.object({
  providerId: z.string().optional(),
});

const outreachSchema = z.object({
  channel: z.string().default('cold_email'),
  tone: z
    .enum(['professional', 'friendly', 'direct', 'short', 'consultative'])
    .default('professional'),
  context: z.string().optional(),
  channels: z.array(z.string()).optional(),
  providerId: z.string().optional(),
});

const exportSchema = z.object({
  format: z.enum(['csv', 'json', 'xlsx']).default('csv'),
});

type ScoredLead = {
  lead: DedupedLead;
  score: ReturnType<typeof scoreLead>;
  sources: LeadSource[];
  confidence: number;
  enriched?: LeadEnrichment;
};

export async function leadFinderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // ─── PROVIDER STATUS ──────────────────────────────────────────────
  app.get('/lead-finder/providers', async (_request, reply) => {
    const statuses = getProviderStatuses();
    return reply.send({ providers: statuses });
  });

  // ─── SEARCH (Natural Language) ────────────────────────────────────
  app.post('/lead-finder/search', async (request, reply) => {
    const userId = requireUserId(request);
    const body = searchSchema.parse(request.body);

    let params: LeadSearchParams;

    if (body.parseNatural) {
      params = await parseSearchQuery(body.query);
      if (body.sources) params.sources = body.sources as LeadSource[];
      if (body.industry) params.industry = body.industry;
      if (body.location) params.location = body.location;
      if (body.country) params.country = body.country;
      if (body.city) params.city = body.city;
      if (body.state) params.state = body.state;
      if (body.limit) params.limit = body.limit;
    } else {
      params = {
        query: body.query,
        sources: body.sources as LeadSource[] | undefined,
        industry: body.industry,
        location: body.location,
        country: body.country,
        city: body.city,
        state: body.state,
        employeeCountMin: body.employeeCountMin,
        employeeCountMax: body.employeeCountMax,
        ratingMin: body.ratingMin,
        ratingMax: body.ratingMax,
        keywords: body.keywords,
        hiringSignals: body.hiringSignals,
        intentSignals: body.intentSignals,
        limit: body.limit ?? 20,
      };
    }

    const startTime = Date.now();

    const providerResults = await searchProviders(params);
    const combined = combineResults(providerResults);
    const deduped = deduplicateLeads(combined);

    const scoredLeads: ScoredLead[] = deduped.map((lead) => ({
      lead,
      score: scoreLead(lead),
      sources: lead.sources,
      confidence: lead.confidence,
    }));

    scoredLeads.sort((a, b) => b.score.total - a.score.total);

    if (body.enrich) {
      const toEnrich = scoredLeads.slice(0, 10);
      for (const item of toEnrich) {
        try {
          item.enriched = await enrichLead(item.lead);
        } catch {
          // best-effort
        }
      }
    }

    // Save search history
    let searchId: string | undefined;
    const db = getDb();
    try {
      const search = await db.leadSearch.create({
        data: {
          userId,
          query: body.query,
          sources: (body.sources ?? [
            'google_maps',
            'linkedin',
            'indeed',
            'reddit',
            'web',
          ]) as string[],
          resultCount: scoredLeads.length,
          duration: Date.now() - startTime,
          errors: providerResults
            .filter((r) => r.error)
            .map((r) => ({
              provider: r.providerId,
              error: r.error ?? '',
            })),
        },
      });
      searchId = search.id;
    } catch {
      // best-effort
    }

    const durationMs = Date.now() - startTime;
    const errors = providerResults
      .filter((r) => r.error)
      .map((r) => ({ providerId: r.providerId, message: r.error! }));

    await recordAudit({
      actorId: request.user?.id as string | undefined,
      actorEmail: (request.user as { email?: string })?.email,
      action: 'leads.search' as AuditAction,
      target: searchId ?? 'unknown',
      detail: `${params.query} -> ${scoredLeads.length} leads`,
    });

    return reply.send({
      leads: scoredLeads,
      total: scoredLeads.length,
      errors,
      durationMs,
      searchId,
    });
  });

  // ─── SEARCH HISTORY ───────────────────────────────────────────────
  app.get('/lead-finder/history', async (request, reply) => {
    const userId = requireUserId(request);
    const db = getDb();
    const searches = await db.leadSearch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return reply.send({ history: searches });
  });

  // ─── SAVE LEAD ────────────────────────────────────────────────────
  app.post('/lead-finder/leads', async (request, reply) => {
    const userId = requireUserId(request);

    const schema = z.object({
      companyName: z.string().min(1),
      companyDescription: z.string().optional(),
      industry: z.string().optional(),
      website: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      country: z.string().optional(),
      employeeCount: z.number().optional(),
      rating: z.number().optional(),
      reviewCount: z.number().optional(),
      linkedinUrl: z.string().optional(),
      googleMapsUrl: z.string().optional(),
      redditUrl: z.string().optional(),
      indeedUrl: z.string().optional(),
      source: z.string(),
      sourceData: z.record(z.unknown()).optional(),
      hiringSignals: z.array(z.string()).optional(),
      intentSignals: z.array(z.string()).optional(),
      painPoints: z.array(z.string()).optional(),
      automationOpportunities: z.array(z.string()).optional(),
      leadScore: z.number().optional(),
      leadScoreReason: z.array(z.string()).optional(),
      enrichmentData: z.record(z.unknown()).optional(),
      confidence: z.number().optional(),
      searchId: z.string().optional(),
    });

    const body = schema.parse(request.body);
    const db = getDb();

    const existing = await db.discoveredLead.findFirst({
      where: {
        userId,
        companyName: body.companyName,
        source: body.source,
      },
    });

    let lead;
    if (existing) {
      lead = await db.discoveredLead.update({
        where: { id: existing.id },
        data: body as never,
      });
    } else {
      lead = await db.discoveredLead.create({
        data: {
          userId,
          searchId: body.searchId ?? null,
          companyName: body.companyName,
          companyDescription: body.companyDescription ?? null,
          industry: body.industry ?? null,
          website: body.website ?? null,
          email: body.email ?? null,
          phone: body.phone ?? null,
          address: body.address ?? null,
          city: body.city ?? null,
          state: body.state ?? null,
          country: body.country ?? null,
          employeeCount: body.employeeCount ?? null,
          rating: body.rating ?? null,
          reviewCount: body.reviewCount ?? null,
          linkedinUrl: body.linkedinUrl ?? null,
          googleMapsUrl: body.googleMapsUrl ?? null,
          redditUrl: body.redditUrl ?? null,
          indeedUrl: body.indeedUrl ?? null,
          source: body.source,
          sourceData: (body.sourceData ?? {}) as never,
          hiringSignals: (body.hiringSignals ?? []) as never,
          intentSignals: (body.intentSignals ?? []) as never,
          painPoints: (body.painPoints ?? []) as never,
          automationOpportunities: (body.automationOpportunities ?? []) as never,
          leadScore: body.leadScore ?? 0,
          leadScoreReason: (body.leadScoreReason ?? []) as never,
          enrichmentData: (body.enrichmentData ?? {}) as never,
          confidence: body.confidence ?? null,
        } as never,
      });
    }

    await recordAudit({
      actorId: request.user?.id as string | undefined,
      actorEmail: (request.user as { email?: string })?.email,
      action: 'leads.lead.saved' as AuditAction,
      target: lead.id,
      detail: lead.companyName,
    });

    await notify({
      userId,
      title: existing ? 'Lead updated' : 'Lead discovered',
      body: `${lead.companyName}${lead.industry ? ` (${lead.industry})` : ''} was saved with a score of ${lead.leadScore}/100.`,
      kind: 'general',
      priority: lead.leadScore >= 70 ? 'high' : 'medium',
      metadata: {
        leadId: lead.id,
        companyName: lead.companyName,
        leadScore: lead.leadScore,
        source: lead.source,
      },
    });

    return reply.status(201).send({ lead });
  });

  // ─── LIST SAVED LEADS ─────────────────────────────────────────────
  app.get('/lead-finder/leads', async (request, reply) => {
    const userId = requireUserId(request);

    const query = (request.query as Record<string, string>) ?? {};
    const status = query.status;
    const industry = query.industry;
    const source = query.source;
    const minScore = query.minScore ? parseInt(query.minScore, 10) : undefined;
    const searchId = query.searchId;
    const sort = query.sort ?? 'leadScore';
    const order = query.order ?? 'desc';
    const page = parseInt(query.page ?? '1', 10);
    const pageSize = Math.min(parseInt(query.pageSize ?? '50', 10), 100);

    const where: Record<string, unknown> = { userId };
    if (status) where.status = status;
    if (industry) where.industry = industry;
    if (source) where.source = source;
    if (minScore !== undefined) where.leadScore = { gte: minScore };
    if (searchId) where.searchId = searchId;

    const db = getDb();
    const [leads, total] = await Promise.all([
      db.discoveredLead.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.discoveredLead.count({ where }),
    ]);

    return reply.send({ leads, total, page, pageSize });
  });

  // ─── GET SINGLE LEAD ──────────────────────────────────────────────
  app.get('/lead-finder/leads/:id', async (request, reply) => {
    const userId = requireUserId(request);
    const { id } = request.params as { id: string };
    const db = getDb();

    const lead = await db.discoveredLead.findFirst({
      where: { id, userId },
    });

    if (!lead) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Lead not found' } });
    }

    return reply.send({ lead });
  });

  // ─── UPDATE LEAD ──────────────────────────────────────────────────
  app.patch('/lead-finder/leads/:id', async (request, reply) => {
    const userId = requireUserId(request);
    const { id } = request.params as { id: string };

    const db = getDb();
    const existing = await db.discoveredLead.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Lead not found' } });
    }

    const schema = z.object({
      status: z.string().optional(),
      notes: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      leadScore: z.number().optional(),
    });

    const body = schema.parse(request.body);
    const data: Record<string, unknown> = {};
    if (body.status) data.status = body.status;
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.email !== undefined) data.email = body.email;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.leadScore !== undefined) data.leadScore = body.leadScore;

    const lead = await db.discoveredLead.update({
      where: { id },
      data: data as never,
    });

    return reply.send({ lead });
  });

  // ─── DELETE LEAD ──────────────────────────────────────────────────
  app.delete('/lead-finder/leads/:id', async (request, reply) => {
    const userId = requireUserId(request);
    const { id } = request.params as { id: string };

    const db = getDb();
    const existing = await db.discoveredLead.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Lead not found' } });
    }

    await db.discoveredLead.delete({ where: { id } });
    return reply.status(204).send();
  });

  // ─── ENRICH LEAD ──────────────────────────────────────────────────
  app.post('/lead-finder/leads/:id/enrich', async (request, reply) => {
    const userId = requireUserId(request);
    const { id } = request.params as { id: string };
    const body = enrichSchema.parse(request.body ?? {});

    const db = getDb();
    const existing = await db.discoveredLead.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Lead not found' } });
    }

    const rawLead: RawLead = {
      companyName: existing.companyName,
      companyDescription: existing.companyDescription ?? undefined,
      industry: existing.industry ?? undefined,
      website: existing.website ?? undefined,
      email: existing.email ?? undefined,
      phone: existing.phone ?? undefined,
      city: existing.city ?? undefined,
      state: existing.state ?? undefined,
      country: existing.country ?? undefined,
      rating: existing.rating ?? undefined,
      reviewCount: existing.reviewCount ?? undefined,
      source: existing.source as LeadSource,
      hiringSignals: (existing.hiringSignals as string[]) ?? [],
      intentSignals: (existing.intentSignals as string[]) ?? [],
      painPoints: (existing.painPoints as string[]) ?? [],
      automationOpportunities: (existing.automationOpportunities as string[]) ?? [],
    };

    const enrichment = await enrichLead(rawLead, body.providerId);

    const lead = await db.discoveredLead.update({
      where: { id },
      data: {
        enrichmentData: enrichment as never,
        painPoints: enrichment.painPoints.map((p) => p.text) as never,
        automationOpportunities: enrichment.automationOpportunities.map((a) => a.text) as never,
      } as never,
    });

    await recordAudit({
      actorId: request.user?.id as string | undefined,
      actorEmail: (request.user as { email?: string })?.email,
      action: 'leads.lead.enriched' as AuditAction,
      target: id,
      detail: lead.companyName,
    });

    await notify({
      userId,
      title: 'Lead enriched',
      body: `AI research completed for ${lead.companyName}: ${enrichment.painPoints.length} pain points and ${enrichment.automationOpportunities.length} automation opportunities identified.`,
      kind: 'general',
      priority: 'low',
      metadata: { leadId: id, companyName: lead.companyName, enrichment },
    });

    return reply.send({ lead, enrichment });
  });

  // ─── GENERATE OUTREACH ────────────────────────────────────────────
  app.post('/lead-finder/leads/:id/outreach', async (request, reply) => {
    const userId = requireUserId(request);
    const { id } = request.params as { id: string };
    const body = outreachSchema.parse(request.body);

    const db = getDb();
    const existing = await db.discoveredLead.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Lead not found' } });
    }

    const rawLead: RawLead = {
      companyName: existing.companyName,
      companyDescription: existing.companyDescription ?? undefined,
      industry: existing.industry ?? undefined,
      website: existing.website ?? undefined,
      phone: existing.phone ?? undefined,
      city: existing.city ?? undefined,
      state: existing.state ?? undefined,
      country: existing.country ?? undefined,
      source: existing.source as LeadSource,
      hiringSignals: (existing.hiringSignals as string[]) ?? [],
      intentSignals: (existing.intentSignals as string[]) ?? [],
      painPoints: (existing.painPoints as string[]) ?? [],
      automationOpportunities: (existing.automationOpportunities as string[]) ?? [],
    };

    let outreach;
    if (body.channels && body.channels.length > 0) {
      outreach = await generateMultiChannelOutreach(
        rawLead,
        body.channels,
        body.tone,
        body.context,
        body.providerId,
      );
    } else {
      const result = await generateOutreach(
        rawLead,
        body.channel,
        body.tone,
        body.context,
        body.providerId,
      );
      outreach = [result];
    }

    await recordAudit({
      actorId: request.user?.id as string | undefined,
      actorEmail: (request.user as { email?: string })?.email,
      action: 'leads.lead.outreach_generated' as AuditAction,
      target: id,
      detail: existing.companyName,
    });

    await notify({
      userId,
      title: 'Outreach drafted',
      body: `Personalized ${outreach.map((m) => m.channel).join(' + ')} message generated for ${existing.companyName}.`,
      kind: 'general',
      priority: 'low',
      metadata: {
        leadId: id,
        companyName: existing.companyName,
        channels: outreach.map((m) => m.channel),
      },
    });

    return reply.send({ outreach });
  });

  // ─── EXPORT LEADS ─────────────────────────────────────────────────
  app.post('/lead-finder/export', async (request, reply) => {
    const userId = requireUserId(request);
    const body = exportSchema.parse(request.body);

    const db = getDb();
    const leads = await db.discoveredLead.findMany({
      where: { userId },
      orderBy: { leadScore: 'desc' },
    });

    if (body.format === 'json') {
      return reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', 'attachment; filename="leads.json"')
        .send(leads);
    }

    const headers = [
      'Company Name',
      'Industry',
      'Website',
      'Email',
      'Phone',
      'Address',
      'City',
      'State',
      'Country',
      'Rating',
      'Review Count',
      'Source',
      'Lead Score',
      'Status',
      'LinkedIn',
      'Created At',
    ];

    const csvRows = [headers.join(',')];
    for (const lead of leads) {
      const row = [
        csvEscape(lead.companyName),
        csvEscape(lead.industry ?? ''),
        csvEscape(lead.website ?? ''),
        csvEscape(lead.email ?? ''),
        csvEscape(lead.phone ?? ''),
        csvEscape(lead.address ?? ''),
        csvEscape(lead.city ?? ''),
        csvEscape(lead.state ?? ''),
        csvEscape(lead.country ?? ''),
        String(lead.rating ?? ''),
        String(lead.reviewCount ?? ''),
        csvEscape(lead.source),
        String(lead.leadScore),
        lead.status,
        csvEscape(lead.linkedinUrl ?? ''),
        lead.createdAt.toISOString(),
      ];
      csvRows.push(row.join(','));
    }

    return reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="leads.csv"')
      .send(csvRows.join('\n'));
  });
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
