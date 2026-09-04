import { registerTool } from '../tools/registry.js';

export function registerLeadFinderTools(): void {
  registerTool({
    name: 'lead_finder_search',
    description:
      'Search for potential customers / leads across Google Maps, LinkedIn, Indeed, Reddit, and the web. ' +
      'Use this to find businesses that could benefit from your services. Provide a natural language query describing the type of customer you want.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language description of the leads to search for',
        },
        sources: {
          type: 'string',
          description:
            'Comma-separated sources to search (google_maps, linkedin, indeed, reddit, web). Default: all',
        },
        limit: { type: 'number', description: 'Maximum number of leads to return (default 20)' },
        enrich: { type: 'boolean', description: 'Whether to AI-enrich top leads (default false)' },
      },
      required: ['query'],
    },
    async execute(args: Record<string, unknown>, context: { userId: string }) {
      const { searchProviders, combineResults, deduplicateLeads, scoreLead, parseSearchQuery } =
        await import('../lead-finder/index.js');
      const prisma = await getPrisma();

      const rawQuery = String(args.query ?? '');
      const sources =
        typeof args.sources === 'string'
          ? args.sources
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
      const limit = typeof args.limit === 'number' ? args.limit : 20;

      const params = await parseSearchQuery(rawQuery);
      if (sources) params.sources = sources as never;
      params.limit = limit;

      const providerResults = await searchProviders(params);
      const combined = combineResults(providerResults);
      const deduped = deduplicateLeads(combined);

      const scored = deduped.map((lead) => ({
        lead,
        score: scoreLead(lead),
        sources: lead.sources,
        confidence: lead.confidence,
      }));
      scored.sort((a, b) => b.score.total - a.score.total);
      const top = scored.slice(0, 10);

      const lines: string[] = [];
      for (const { lead, score, sources: leadSources } of top) {
        lines.push(
          `${lead.companyName} (score ${score.total}/100)` +
            (lead.city || lead.state
              ? ` - ${[lead.city, lead.state].filter(Boolean).join(', ')}`
              : '') +
            (lead.website ? ` - ${lead.website}` : '') +
            (leadSources.length > 1 ? ` - ${leadSources.join('+')}` : ''),
        );
      }

      const errors = providerResults
        .filter((r) => r.error)
        .map((r) => `${r.providerId}: ${r.error}`);

      if (prisma) {
        try {
          await prisma.leadSearch.create({
            data: {
              userId: context.userId,
              query: rawQuery,
              sources: sources ?? ['google_maps', 'linkedin', 'indeed', 'reddit', 'web'],
              resultCount: scored.length,
              errors: errors.map((e) => ({ error: e })),
            },
          });
        } catch {
          // best-effort
        }
      }

      const summary: string[] = [];
      summary.push(`Search: "${rawQuery}"`);
      summary.push(
        `Found ${scored.length} leads across ${providerResults.filter((r) => r.leads.length > 0).length} providers.`,
      );
      if (lines.length) {
        summary.push('Top leads:');
        summary.push(lines.join('\n'));
      } else {
        summary.push('No leads found.');
      }
      if (errors.length) {
        summary.push(`Provider warnings:\n${errors.join('\n')}`);
      }
      return summary.join('\n');
    },
  });

  registerTool({
    name: 'lead_finder_save',
    description: "Save a discovered lead to the user's CRM for later follow-up.",
    parameters: {
      type: 'object',
      properties: {
        companyName: { type: 'string', description: 'Company name' },
        website: { type: 'string', description: 'Website URL' },
        city: { type: 'string' },
        state: { type: 'string' },
        country: { type: 'string' },
        industry: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        source: {
          type: 'string',
          description: 'Source (google_maps, linkedin, indeed, reddit, web)',
        },
        leadScore: { type: 'number', description: 'Lead score 0-100' },
      },
      required: ['companyName'],
    },
    async execute(args: Record<string, unknown>, context: { userId: string }) {
      const prisma = await getPrisma();
      if (!prisma) return 'Database not available.';

      const body = {
        companyName: String(args.companyName ?? ''),
        website: args.website ? String(args.website) : undefined,
        city: args.city ? String(args.city) : undefined,
        state: args.state ? String(args.state) : undefined,
        country: args.country ? String(args.country) : undefined,
        industry: args.industry ? String(args.industry) : undefined,
        phone: args.phone ? String(args.phone) : undefined,
        email: args.email ? String(args.email) : undefined,
        source: String(args.source ?? 'ai_extension'),
        leadScore: typeof args.leadScore === 'number' ? args.leadScore : undefined,
      };

      const existing = await prisma.discoveredLead.findFirst({
        where: { userId: context.userId, companyName: body.companyName },
      });

      if (existing) {
        await prisma.discoveredLead.update({ where: { id: existing.id }, data: body });
        return `Lead "${body.companyName}" already existed and was updated.`;
      }

      const lead = await prisma.discoveredLead.create({
        data: {
          userId: context.userId,
          ...body,
          leadScore: body.leadScore ?? 0,
          source: body.source,
        },
      });
      return `Saved lead "${lead.companyName}" (ID: ${lead.id}).`;
    },
  });

  registerTool({
    name: 'lead_finder_generate_outreach',
    description: 'Generate a personalized outreach message for a saved lead.',
    parameters: {
      type: 'object',
      properties: {
        leadId: { type: 'string', description: 'The saved lead ID' },
        channel: {
          type: 'string',
          description: 'Channel: cold_email, linkedin, whatsapp, or follow_up',
        },
        tone: {
          type: 'string',
          description: 'Tone: professional, friendly, direct, short, or consultative',
        },
        context: { type: 'string', description: 'Additional context about what to mention' },
      },
      required: ['leadId'],
    },
    async execute(args: Record<string, unknown>, context: { userId: string }) {
      const { generateOutreach } = await import('../lead-finder/index.js');
      const prisma = await getPrisma();
      if (!prisma) return 'Database not available.';

      const lead = await prisma.discoveredLead.findFirst({
        where: { id: String(args.leadId), userId: context.userId },
      });
      if (!lead) return `Lead not found: ${String(args.leadId)}`;

      const result = await generateOutreach(
        {
          companyName: lead.companyName,
          companyDescription: lead.companyDescription ?? undefined,
          industry: lead.industry ?? undefined,
          website: lead.website ?? undefined,
          city: lead.city ?? undefined,
          state: lead.state ?? undefined,
          source: lead.source as never,
        },
        String(args.channel ?? 'cold_email'),
        (args.tone as 'professional') ?? 'professional',
        args.context ? String(args.context) : undefined,
      );

      return `Generated ${result.channel} outreach for ${lead.companyName}:\n\n${result.subject ? `Subject: ${result.subject}\n\n` : ''}${result.body}`;
    },
  });
}

async function getPrisma(): Promise<(typeof import('../lib/prisma.js'))['prisma']> {
  const { prisma } = await import('../lib/prisma.js');
  return prisma;
}
