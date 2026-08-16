import { describe, expect, it } from 'vitest';
import { analyzeMargin } from '../../src/sales/margin.js';

describe('margin analysis', () => {
  it('computes the margin from price and cost', () => {
    const result = analyzeMargin({
      minimumPrice: 1000,
      targetPrice: 1400,
      targetMargin: 40,
      estimatedCost: 700,
    });
    expect(result.estimatedMargin).toBe(700);
    expect(result.estimatedMarginPercent).toBe(50);
    expect(result.status).toBe('healthy');
    expect(result.currency).toBe('USD');
  });

  it('marks thin margins when below target but close', () => {
    const result = analyzeMargin({
      targetPrice: 1000,
      targetMargin: 40,
      estimatedCost: 650,
    });
    expect(result.estimatedMarginPercent).toBe(35);
    expect(result.status).toBe('thin');
  });

  it('marks at-risk margins well below target', () => {
    const result = analyzeMargin({
      targetPrice: 1000,
      targetMargin: 40,
      estimatedCost: 800,
    });
    expect(result.estimatedMarginPercent).toBe(20);
    expect(result.status).toBe('at-risk');
  });

  it('derives an implied cost from the target margin when cost is unknown', () => {
    const result = analyzeMargin({
      minimumPrice: 1000,
      targetMargin: 40,
    });
    expect(result.estimatedCost).toBeCloseTo(600, 5);
    expect(result.estimatedMarginPercent).toBe(40);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('caps the margin percent at 90 and handles zero price', () => {
    const result = analyzeMargin({ targetMargin: 95 });
    expect(result.targetMargin).toBe(90);
    expect(result.estimatedMarginPercent).toBe(0);
    expect(result.status).toBe('at-risk');
  });
});
