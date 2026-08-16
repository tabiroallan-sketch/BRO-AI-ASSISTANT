/**
 * Reusable sales-methodology guidance injected into sales prompts. Kept
 * separate from the intelligence/pitch prompts so the frameworks are shared
 * and easy to extend without touching the consuming modules.
 */

export const SALES_PRINCIPLES = [
  'Use consultative, value-based selling. Always lead with the prospect\'s business problem and the outcome they will get, never with generic statements like "I am a talented developer".',
  'Never invent facts. No fake experience, fake statistics, fake testimonials, fake case studies, or fabricated portfolio items. If you do not know something, say so and mark it as needing verification.',
  "Be concrete and specific. Reference the prospect's actual industry, company, and situation. Generic spam is forbidden.",
  'Every message should have one clear call to action and be short enough to read in under 30 seconds.',
  'Respect the reader: no pressure tactics, no fake urgency, no emotional manipulation.',
] as const;

export const SPIN_SELLING =
  'SPIN selling framework:\n' +
  "- Situation: establish facts about the prospect's context before proposing anything.\n" +
  '- Problem: surface the problems they likely face (pain points).\n' +
  '- Implication: make the cost of doing nothing concrete (what the problem costs them).\n' +
  '- Need-payoff: frame your offer around the payoff (what solving it is worth).\n' +
  'Use Problem and Implication questions in outreach; never jump straight to the pitch.';

export const BANT =
  'BANT qualification:\n' +
  '- Budget: do they have budget, and roughly how much?\n' +
  '- Authority: who decides, and how does the buying process work?\n' +
  '- Need: what is the real need behind the interest?\n' +
  '- Timeline: when do they want to act?\n' +
  'Use BANT to qualify leads, not as a script to interrogate them with.';

export const AIDA =
  'AIDA copy structure:\n' +
  '- Attention: an opening line that earns their attention (specific, relevant to them).\n' +
  '- Interest: build interest with their problem and what solving it looks like.\n' +
  '- Desire: make the outcome desirable with concrete, truthful specifics.\n' +
  '- Action: one clear, low-friction next step.';

export const PAS =
  'PAS copy structure:\n' +
  '- Problem: name their problem precisely.\n' +
  '- Agitate: make clear why it matters and what it costs them if ignored.\n' +
  '- Solution: present your offer as the resolution.';

export const VALUE_BASED_SELLING =
  'Value-based selling:\n' +
  '- Quantify value in terms the prospect cares about (time saved, revenue gained, risk removed), only using figures you can actually stand behind.\n' +
  '- Sell the outcome, not the hours or the tech. Tech details are supporting evidence, not the pitch.\n' +
  '- Price by value delivered, not by effort. Anchor to the cost of the problem, not your hourly rate.';

export const OBJECTION_HANDLING =
  'Objection handling:\n' +
  '- Listen fully, restate the objection to confirm understanding, then answer it.\n' +
  '- Separate concerns: price, timing, trust, and fit are different objections and need different responses.\n' +
  '- Never dismiss or argue. Validate the concern and offer evidence or an alternative.\n' +
  '- Common objections and angles: cost ("what is the cost of not doing this?"), timing ("what triggers a move?"), trust ("offer a small pilot, references you can verify"), "no budget" (show ROI and payment options).';

export const NEGOTIATION =
  'Negotiation:\n' +
  '- Anchor high but honestly; never inflate to make yourself look worse later.\n' +
  '- Trade concessions for commitments: give scope or price only when you get something back (longer term, more scope, faster decision).\n' +
  '- Know your walk-away point (minimum price / margin floor) before negotiating.\n' +
  '- Summarize agreements in writing to prevent scope creep.';

export const UPSELLING =
  'Upselling:\n' +
  '- Only suggest an upsell when it genuinely solves another problem the client has; never pad.\n' +
  '- Tie upsells to the outcome of the main project (e.g. "once the site is live, SEO turns it into traffic").\n' +
  '- Mention recurring services that keep the result working, phrased as a natural next step.';

export function salesMethodologyBlock(): string {
  return [
    'Sales methodology you should apply:',
    SPIN_SELLING,
    BANT,
    AIDA,
    PAS,
    VALUE_BASED_SELLING,
    OBJECTION_HANDLING,
    NEGOTIATION,
    UPSELLING,
  ].join('\n\n');
}
