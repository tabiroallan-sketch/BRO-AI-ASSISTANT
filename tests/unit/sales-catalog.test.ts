import { describe, expect, it } from 'vitest';
import { DEFAULT_SERVICES, estimatePrice } from '../../src/sales/catalog.js';
import type { ServiceLike } from '../../src/sales/types.js';

function makeService(overrides: Partial<ServiceLike>): ServiceLike {
  return {
    id: 'svc-1',
    userId: 'user-1',
    name: 'Test service',
    description: null,
    pricing: null,
    minimumPrice: null,
    targetMargin: 30,
    requiredSkills: [],
    deliveryEstimate: null,
    upsells: [],
    recurringServices: [],
    active: true,
    sortOrder: 0,
    ...overrides,
  };
}

describe('service price estimation', () => {
  it('adds the target margin to the minimum price', () => {
    const estimate = estimatePrice(makeService({ minimumPrice: 1000, targetMargin: 40 }));
    expect(estimate.minimumPrice).toBe(1000);
    expect(estimate.suggestedPrice).toBe(1400);
    expect(estimate.targetMargin).toBe(40);
  });

  it('uses heuristics when no minimum price is set', () => {
    const monthly = estimatePrice(makeService({ pricing: 'Monthly retainer' }));
    expect(monthly.suggestedPrice).toBe(500);

    const project = estimatePrice(makeService({ pricing: 'Project-based' }));
    expect(project.suggestedPrice).toBe(3000);
  });

  it('clamps the target margin to the 0-90 range', () => {
    const high = estimatePrice(makeService({ minimumPrice: 100, targetMargin: 95 }));
    expect(high.targetMargin).toBe(90);
    const low = estimatePrice(makeService({ minimumPrice: 100, targetMargin: -5 }));
    expect(low.targetMargin).toBe(0);
  });

  it('treats a string minimum price as a number', () => {
    const estimate = estimatePrice(makeService({ minimumPrice: '2000', targetMargin: 50 }));
    expect(estimate.suggestedPrice).toBe(3000);
  });

  it('returns a sane default for a blank service', () => {
    const estimate = estimatePrice(makeService({}));
    expect(estimate.suggestedPrice).toBeGreaterThan(0);
    expect(estimate.currency).toBe('USD');
  });
});

describe('default service catalog', () => {
  it('contains the expected seeded services', () => {
    const names = DEFAULT_SERVICES.map((service) => service.name);
    expect(names).toContain('Website development');
    expect(names).toContain('AI automation');
    expect(names).toContain('Lead generation');
  });

  it('has positive minimum prices and sane margins', () => {
    for (const service of DEFAULT_SERVICES) {
      expect(service.minimumPrice).toBeGreaterThan(0);
      expect(service.targetMargin).toBeGreaterThanOrEqual(0);
      expect(service.targetMargin).toBeLessThanOrEqual(90);
    }
  });
});
