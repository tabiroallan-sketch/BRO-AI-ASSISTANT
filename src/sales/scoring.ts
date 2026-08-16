import type {
  OpportunityScoreInput,
  OpportunityTypeValue,
  ScoreBreakdown,
  ScoreResult,
  ScoreWeights,
} from './types.js';

/**
 * Default scoring weights. The seven factors sum to 100 and each factor is a
 * rating on a 0-10 scale. The final score is `sum(rating * weight) / 10`.
 *
 * Overridable via the `SALES_SCORE_WEIGHTS` environment variable (JSON object)
 * or by calling `setScoreWeights` (used in tests).
 */
const DEFAULT_WEIGHTS: ScoreWeights = {
  skillFit: 25,
  budget: 15,
  profitPotential: 15,
  clientQuality: 10,
  urgency: 10,
  recurringPotential: 10,
  winProbability: 15,
};

const WEIGHT_KEYS = [
  'skillFit',
  'budget',
  'profitPotential',
  'clientQuality',
  'urgency',
  'recurringPotential',
  'winProbability',
] as const;

let scoreWeights: ScoreWeights = loadWeightsFromEnv();

function loadWeightsFromEnv(): ScoreWeights {
  try {
    const raw = process.env.SALES_SCORE_WEIGHTS;
    if (!raw) {
      return { ...DEFAULT_WEIGHTS };
    }
    const parsed = JSON.parse(raw) as Partial<Record<keyof ScoreWeights, unknown>>;
    const weights = normalizeWeights(parsed);
    return weights;
  } catch {
    return { ...DEFAULT_WEIGHTS };
  }
}

export function getScoreWeights(): ScoreWeights {
  return { ...scoreWeights };
}

export function setScoreWeights(weights: ScoreWeights): void {
  scoreWeights = normalizeWeights(weights);
}

export function resetScoreWeights(): void {
  scoreWeights = loadWeightsFromEnv();
}

/** Clamps each weight to 0-100 and re-normalizes so the seven weights sum to 100. */
export function normalizeWeights(
  weights: Partial<Record<keyof ScoreWeights, unknown>>,
): ScoreWeights {
  const raw = { ...DEFAULT_WEIGHTS };
  for (const key of WEIGHT_KEYS) {
    const value = weights[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      raw[key] = Math.max(0, Math.min(100, value));
    }
  }
  const total = WEIGHT_KEYS.reduce((sum, key) => sum + raw[key], 0);
  if (total <= 0) {
    return { ...DEFAULT_WEIGHTS };
  }
  const normalized = { ...raw };
  for (const key of WEIGHT_KEYS) {
    normalized[key] = Math.round((raw[key] / total) * 100);
  }
  // Fix rounding drift so the weights always sum to exactly 100.
  const drift = 100 - WEIGHT_KEYS.reduce((sum, key) => sum + normalized[key], 0);
  if (drift !== 0) {
    normalized.winProbability = Math.max(0, normalized.winProbability + drift);
  }
  return normalized;
}

function clampRating(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(10, Math.round(value)));
}

function budgetNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function budgetRating(value: number | string | null | undefined): number {
  const amount = budgetNumber(value);
  if (amount <= 0) {
    return 3;
  }
  if (amount >= 50_000) {
    return 10;
  }
  if (amount >= 20_000) {
    return 9;
  }
  if (amount >= 10_000) {
    return 8;
  }
  if (amount >= 5_000) {
    return 7;
  }
  if (amount >= 2_500) {
    return 6;
  }
  if (amount >= 1_000) {
    return 5;
  }
  return 4;
}

function skillFitRating(required: string[] | undefined, owned: string[] | undefined): number {
  const skills = (required ?? []).map((skill) => skill.trim().toLowerCase()).filter(Boolean);
  const available = (owned ?? []).map((skill) => skill.trim().toLowerCase()).filter(Boolean);
  if (skills.length === 0) {
    return available.length > 0 ? 7 : 5;
  }
  if (available.length === 0) {
    return 5;
  }
  const matched = skills.filter((skill) =>
    available.some((candidate) => candidate.includes(skill) || skill.includes(candidate)),
  ).length;
  return Math.round((matched / skills.length) * 10);
}

function recurringRating(type: OpportunityTypeValue | undefined): number {
  switch (type) {
    case 'RECURRING':
      return 10;
    case 'PARTNERSHIP':
      return 8;
    case 'OUTSOURCING':
      return 6;
    default:
      return 4;
  }
}

function winProbabilityFromStatus(status: string | undefined): number {
  switch (status) {
    case 'WON':
      return 10;
    case 'PROPOSED':
      return 8;
    case 'EVALUATING':
      return 6;
    case 'LOST':
      return 1;
    default:
      return 4;
  }
}

/**
 * Computes a 0-100 opportunity score from a weighted blend of seven factors.
 * Explicit ratings (0-10) win over auto-derived ratings, which are inferred
 * from the opportunity's fields so a bare record can still be scored.
 */
export function scoreOpportunity(
  input: OpportunityScoreInput,
  weights = scoreWeights,
): ScoreResult {
  const normalized = normalizeWeights(weights);
  const autoSkillFit = skillFitRating(input.requiredSkills, input.userSkills);
  const autoBudget = budgetRating(input.estimatedBudget);
  const autoRecurring = recurringRating(input.type);
  const autoWin = winProbabilityFromStatus(input.status);

  const skillFit = clampRating(input.skillFit, autoSkillFit);
  const budget = clampRating(input.budget, autoBudget);
  const profitPotential = clampRating(input.profitPotential, Math.round((autoBudget + budget) / 2));
  const clientQuality = clampRating(input.clientQuality, input.source ? 6 : 5);
  const urgency = clampRating(input.urgencyRating, input.urgency ? 6 : 3);
  const recurringPotential = clampRating(input.recurringPotential, autoRecurring);
  const winProbability = clampRating(input.winProbability, autoWin);

  const contributions = {
    skillFit,
    budget,
    profitPotential,
    clientQuality,
    urgency,
    recurringPotential,
    winProbability,
  };

  const breakdown = {} as ScoreBreakdown;
  let score = 0;
  for (const key of WEIGHT_KEYS) {
    const weight = normalized[key];
    const rating = contributions[key];
    breakdown[key] = {
      rating,
      weight,
      contribution: (rating * weight) / 10,
    };
    score += (rating * weight) / 10;
  }

  return {
    score: Math.round(score),
    breakdown,
    weights: normalized,
  };
}
