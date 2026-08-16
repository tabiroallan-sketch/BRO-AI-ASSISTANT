import type { MarginAnalysis } from './types.js';

export type MarginInput = {
  minimumPrice?: number | string | null;
  targetPrice?: number | string | null;
  targetMargin?: number;
  estimatedCost?: number | string | null;
  currency?: string;
  deliveryEstimate?: string;
};

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Deterministic margin analysis. Computes the margin that results from the
 * given price and cost, and compares it to the target margin. When a cost is
 * unknown, it is estimated conservatively from the target margin so the
 * analysis always yields a usable signal without inventing hard numbers.
 */
export function analyzeMargin(input: MarginInput): MarginAnalysis {
  const minimumPrice = toNumber(input.minimumPrice);
  const targetPrice = toNumber(input.targetPrice);
  const targetMargin = Math.max(0, Math.min(90, toNumber(input.targetMargin)));
  const currency = input.currency || 'USD';

  const price = targetPrice > 0 ? targetPrice : minimumPrice > 0 ? minimumPrice : 0;
  let estimatedCost = toNumber(input.estimatedCost);
  if (estimatedCost <= 0 && price > 0) {
    const marginFactor = targetMargin > 0 ? 1 - targetMargin / 100 : 0.7;
    estimatedCost = price * marginFactor;
  }

  const notes: string[] = [];
  if (
    input.estimatedCost === null ||
    input.estimatedCost === undefined ||
    input.estimatedCost === ''
  ) {
    notes.push(
      `No cost figure supplied; an implied cost of ${currency} ${estimatedCost} was derived from the target margin for planning only.`,
    );
  }
  if (
    input.minimumPrice === null ||
    input.minimumPrice === undefined ||
    input.minimumPrice === ''
  ) {
    notes.push('No minimum price supplied; the analysis used the target price.');
  }

  const estimatedMargin = price - estimatedCost;
  const estimatedMarginPercent = price > 0 ? Math.round((estimatedMargin / price) * 100) : 0;

  let status: MarginAnalysis['status'];
  if (estimatedMarginPercent >= targetMargin) {
    status = 'healthy';
  } else if (estimatedMarginPercent >= Math.max(0, targetMargin - 10)) {
    status = 'thin';
  } else {
    status = 'at-risk';
  }

  if (status === 'thin') {
    notes.push('Margin is thinner than target. Raise the price or reduce delivery cost.');
  }
  if (status === 'at-risk') {
    notes.push(
      'Margin is at risk. Do not discount below the minimum price without trimming scope.',
    );
  }

  return {
    minimumPrice,
    targetPrice: price,
    targetMargin,
    estimatedCost,
    estimatedMargin,
    estimatedMarginPercent,
    status,
    currency,
    notes,
  };
}
