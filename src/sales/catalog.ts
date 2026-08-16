import { prisma } from '../lib/prisma.js';
import type { PriceEstimate, ServiceLike } from './types.js';

export type DefaultService = {
  name: string;
  description: string;
  pricing: string;
  minimumPrice: number;
  targetMargin: number;
  requiredSkills: string[];
  deliveryEstimate: string;
  upsells: string[];
  recurringServices: string[];
  sortOrder: number;
};

/** Default catalog seeded per user. Users can edit, delete, or add their own. */
export const DEFAULT_SERVICES: DefaultService[] = [
  {
    name: 'Website development',
    description: 'Marketing sites, landing pages, and business websites built to convert visitors.',
    pricing: 'Project-based; fixed quote after scope call',
    minimumPrice: 1500,
    targetMargin: 40,
    requiredSkills: ['react', 'nextjs', 'tailwind', 'seo'],
    deliveryEstimate: '2-4 weeks',
    upsells: ['SEO', 'Social media management', 'Ongoing maintenance'],
    recurringServices: ['Maintenance retainer'],
    sortOrder: 1,
  },
  {
    name: 'AI automation',
    description: 'Automate repetitive workflows so the business runs without busywork.',
    pricing: 'Project-based plus monthly retainer',
    minimumPrice: 1000,
    targetMargin: 45,
    requiredSkills: ['n8n', 'api', 'zapier', 'automation'],
    deliveryEstimate: '1-3 weeks',
    upsells: ['AI agents', 'CRM automation'],
    recurringServices: ['Automation monitoring retainer'],
    sortOrder: 2,
  },
  {
    name: 'AI agents',
    description: 'Custom AI agents that answer, research, and take action for the business.',
    pricing: 'Project-based plus monthly retainer',
    minimumPrice: 2500,
    targetMargin: 50,
    requiredSkills: ['llm', 'rag', 'prompt-engineering', 'typescript'],
    deliveryEstimate: '3-6 weeks',
    upsells: ['AI automation', 'CRM automation'],
    recurringServices: ['Agent hosting and maintenance'],
    sortOrder: 3,
  },
  {
    name: 'SaaS development',
    description: 'Full-stack web apps, internal tools, and SaaS products from idea to launch.',
    pricing: 'Project-based; phased milestones',
    minimumPrice: 5000,
    targetMargin: 40,
    requiredSkills: ['react', 'nodejs', 'postgres', 'typescript'],
    deliveryEstimate: '6-12 weeks',
    upsells: ['AI automation', 'Website development'],
    recurringServices: ['Maintenance retainer'],
    sortOrder: 4,
  },
  {
    name: 'CRM automation',
    description: 'Connect and automate the CRM so leads, follow-ups, and reporting run themselves.',
    pricing: 'Setup fee plus monthly retainer',
    minimumPrice: 800,
    targetMargin: 45,
    requiredSkills: ['hubspot', 'n8n', 'crm', 'automation'],
    deliveryEstimate: '1-2 weeks',
    upsells: ['AI automation', 'Lead generation'],
    recurringServices: ['CRM management retainer'],
    sortOrder: 5,
  },
  {
    name: 'Lead generation',
    description: 'Build and qualify a pipeline of prospects with research and outreach support.',
    pricing: 'Monthly retainer',
    minimumPrice: 500,
    targetMargin: 50,
    requiredSkills: ['research', 'linkedin', 'cold-email', 'copywriting'],
    deliveryEstimate: 'Ongoing',
    upsells: ['CRM automation', 'AI automation'],
    recurringServices: ['Monthly retainer'],
    sortOrder: 6,
  },
  {
    name: 'SEO',
    description: 'On-page and technical SEO to grow organic traffic and qualified visits.',
    pricing: 'Monthly retainer or project',
    minimumPrice: 400,
    targetMargin: 40,
    requiredSkills: ['seo', 'content', 'analytics'],
    deliveryEstimate: 'Ongoing',
    upsells: ['Website development', 'Social media management'],
    recurringServices: ['Monthly retainer'],
    sortOrder: 7,
  },
  {
    name: 'Social media management',
    description: 'Content, scheduling, and engagement for the business social channels.',
    pricing: 'Monthly retainer',
    minimumPrice: 350,
    targetMargin: 50,
    requiredSkills: ['content', 'copywriting', 'design'],
    deliveryEstimate: 'Ongoing',
    upsells: ['Lead generation', 'Website development'],
    recurringServices: ['Monthly retainer'],
    sortOrder: 8,
  },
  {
    name: 'Mobile app development',
    description: 'Cross-platform iOS and Android apps built with React Native or native tooling.',
    pricing: 'Project-based; phased milestones',
    minimumPrice: 4000,
    targetMargin: 40,
    requiredSkills: ['react-native', 'mobile', 'typescript'],
    deliveryEstimate: '8-16 weeks',
    upsells: ['SaaS development', 'AI automation'],
    recurringServices: ['Maintenance retainer'],
    sortOrder: 9,
  },
];

export type ServiceInput = {
  name: string;
  description?: string;
  pricing?: string;
  minimumPrice?: number | string;
  targetMargin?: number;
  requiredSkills?: string[];
  deliveryEstimate?: string;
  upsells?: string[];
  recurringServices?: string[];
  active?: boolean;
  sortOrder?: number;
};

/**
 * Seeds the default catalog for a user, skipping any service that already
 * exists by name. Idempotent; safe to call on every boot.
 */
export async function seedDefaultServices(userId: string): Promise<number> {
  if (!prisma) {
    return 0;
  }
  const existing = await prisma.service.findMany({
    where: { userId },
    select: { name: true },
  });
  const names = new Set(existing.map((service) => service.name.toLowerCase()));
  const toCreate = DEFAULT_SERVICES.filter((service) => !names.has(service.name.toLowerCase()));
  if (toCreate.length === 0) {
    return 0;
  }
  const created = await prisma.service.createMany({
    data: toCreate.map((service) => ({
      userId,
      name: service.name,
      description: service.description,
      pricing: service.pricing,
      minimumPrice: service.minimumPrice,
      targetMargin: service.targetMargin,
      requiredSkills: service.requiredSkills,
      deliveryEstimate: service.deliveryEstimate,
      upsells: service.upsells,
      recurringServices: service.recurringServices,
      sortOrder: service.sortOrder,
    })),
  });
  return created.count;
}

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

/**
 * Estimates a price for a service: a suggested figure that preserves the
 * target margin on top of the minimum price. When no minimum price is set,
 * the estimate is based on the service's pricing description heuristics.
 */
export function estimatePrice(service: ServiceLike): PriceEstimate {
  const minimumPrice = toNumber(service.minimumPrice);
  const targetMargin = Math.max(0, Math.min(90, service.targetMargin ?? 30));
  const margin = targetMargin / 100;

  let suggested: number;
  if (minimumPrice > 0) {
    suggested = minimumPrice * (1 + margin);
  } else {
    const pricing = (service.pricing ?? '').toLowerCase();
    if (pricing.includes('monthly') || pricing.includes('retainer')) {
      suggested = 500;
    } else if (pricing.includes('project') || pricing.includes('app')) {
      suggested = 3000;
    } else {
      suggested = 1000;
    }
  }

  return {
    minimumPrice,
    suggestedPrice: Math.round(suggested),
    targetMargin: Math.round(targetMargin),
    currency: 'USD',
  };
}

export type ServiceSearchOptions = {
  userId: string;
  query?: string;
  activeOnly?: boolean;
};

export async function listServices(options: ServiceSearchOptions): Promise<ServiceLike[]> {
  if (!prisma) {
    return [];
  }
  const services = await prisma.service.findMany({
    where: {
      userId: options.userId,
      ...(options.activeOnly ? { active: true } : {}),
      ...(options.query ? { name: { contains: options.query, mode: 'insensitive' as const } } : {}),
    },
    orderBy: [{ sortOrder: 'asc' as const }, { name: 'asc' as const }],
  });
  return services.map((service) => ({
    ...service,
    minimumPrice: service.minimumPrice?.toString() ?? null,
  }));
}
