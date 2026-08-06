import { fetchWithTimeout } from '../../../lib/http.js';
import type { TokenProviderDef } from '../../types.js';

async function stripeAccountName(secretKey: string): Promise<string | null> {
  const response = await fetchWithTimeout('https://api.stripe.com/v1/account', {
    timeoutMs: 10_000,
    headers: { authorization: `Bearer ${secretKey}` },
  });
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as {
    email?: string;
    business_profile?: { name?: string | null };
  };
  return body.business_profile?.name || body.email || 'Stripe';
}

export const stripeProvider: TokenProviderDef = {
  id: 'stripe',
  label: 'Stripe',
  description: 'Payments, customers, products, and account details.',
  type: 'token',
  icon: 'stripe',
  oauthConfigured: true,
  capabilities: ['stripe:payments', 'stripe:account'],
  permissions: [
    {
      id: 'stripe.payments',
      label: 'Payments',
      description: 'Read payments, balances, and charge details.',
      scope: '',
      capability: 'stripe:payments',
    },
    {
      id: 'stripe.account',
      label: 'Account',
      description: 'Read your Stripe account profile.',
      scope: '',
      capability: 'stripe:account',
    },
  ],
  fields: [
    {
      name: 'secretKey',
      label: 'Secret key',
      placeholder: 'sk_live_… or sk_test_…',
    },
  ],
  async healthCheck(secretKey) {
    const account = await stripeAccountName(secretKey);
    return {
      ok: account !== null,
      accountName: account,
      message: account === null ? 'Could not reach Stripe with this key' : null,
    };
  },
};
