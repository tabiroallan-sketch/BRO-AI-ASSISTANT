import { afterEach, describe, expect, it } from 'vitest';
import {
  getScoreWeights,
  normalizeWeights,
  resetScoreWeights,
  scoreOpportunity,
  setScoreWeights,
} from '../../src/sales/scoring.js';

describe('opportunity scoring', () => {
  afterEach(() => {
    resetScoreWeights();
  });

  it('returns a score in the 0-100 range', () => {
    const result = scoreOpportunity({
      type: 'POTENTIAL_CLIENT',
      estimatedBudget: 5000,
      requiredSkills: ['react', 'nextjs'],
      userSkills: ['react', 'nextjs', 'tailwind'],
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('scores a well-matched opportunity higher than a poor match', () => {
    const good = scoreOpportunity({
      type: 'POTENTIAL_CLIENT',
      estimatedBudget: 20000,
      urgency: 'needs to start this month',
      requiredSkills: ['react', 'nodejs'],
      userSkills: ['react', 'nodejs', 'postgres'],
    });
    const poor = scoreOpportunity({
      type: 'POTENTIAL_CLIENT',
      requiredSkills: ['cobol', 'mainframe'],
      userSkills: ['react'],
    });
    expect(good.score).toBeGreaterThan(poor.score);
  });

  it('default weights always sum to exactly 100', () => {
    const weights = getScoreWeights();
    const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBe(100);
  });

  it('normalizes weights so they sum to 100', () => {
    const normalized = normalizeWeights({
      skillFit: 50,
      budget: 50,
      profitPotential: 50,
      clientQuality: 0,
      urgency: 0,
      recurringPotential: 0,
      winProbability: 0,
    });
    const total = Object.values(normalized).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBe(100);
  });

  it('allows overriding weights with setScoreWeights', () => {
    setScoreWeights({
      skillFit: 100,
      budget: 0,
      profitPotential: 0,
      clientQuality: 0,
      urgency: 0,
      recurringPotential: 0,
      winProbability: 0,
    });
    const result = scoreOpportunity({
      type: 'JOB',
      estimatedBudget: 0,
      requiredSkills: ['react'],
      userSkills: ['react'],
    });
    const total = Object.values(result.weights).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBe(100);
    expect(result.breakdown.skillFit.weight).toBe(100);
  });

  it('clamps explicit ratings to 0-10', () => {
    const result = scoreOpportunity({ skillFit: 99, budget: -5, winProbability: 10 });
    expect(result.breakdown.skillFit.rating).toBe(10);
    expect(result.breakdown.budget.rating).toBe(0);
    expect(result.breakdown.winProbability.rating).toBe(10);
  });

  it('rewards recurring and partnership types for recurring potential', () => {
    const recurring = scoreOpportunity({ type: 'RECURRING' });
    const oneOff = scoreOpportunity({ type: 'JOB' });
    expect(recurring.breakdown.recurringPotential.rating).toBeGreaterThan(
      oneOff.breakdown.recurringPotential.rating,
    );
  });

  it('reflects win probability from status', () => {
    const won = scoreOpportunity({ status: 'WON' });
    const newDeal = scoreOpportunity({ status: 'NEW' });
    expect(won.breakdown.winProbability.rating).toBe(10);
    expect(newDeal.breakdown.winProbability.rating).toBeLessThan(10);
  });

  it('produces contribution = rating * weight / 10 for every factor', () => {
    const result = scoreOpportunity({
      type: 'OUTSOURCING',
      estimatedBudget: 8000,
      urgency: 'urgent',
      source: 'referral',
    });
    for (const key of Object.keys(result.breakdown) as (keyof typeof result.breakdown)[]) {
      const { rating, weight, contribution } = result.breakdown[key];
      expect(contribution).toBeCloseTo((rating * weight) / 10, 5);
    }
  });

  it('scores an empty opportunity without throwing', () => {
    const result = scoreOpportunity({});
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
