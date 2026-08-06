import { listUserIntegrations, type IntegrationRecord } from '../integrations/store.js';
import { listProviders } from '../integrations/providers.js';
import { listTools } from '../tools/registry.js';

export type ProviderGroup = {
  providerId: string;
  label: string;
  tools: string[];
  accountName?: string | null;
};

export type IntegrationAwareness = {
  connected: ProviderGroup[];
  available: ProviderGroup[];
  unavailable: ProviderGroup[];
};

/**
 * Discovers which integration-backed tools exist and which of their providers
 * the user has actually connected, so the model can (a) pick the right tool for
 * a connected account and (b) tell the user they need to connect an account
 * that is available but not connected yet.
 */
export async function buildIntegrationAwareness(userId: string): Promise<IntegrationAwareness> {
  let connected = new Map<string, IntegrationRecord>();
  try {
    connected = await listUserIntegrations(userId);
  } catch {
    // Awareness is a progressive enhancement: never let a DB hiccup break chat.
  }
  const providerById = new Map(listProviders().map((provider) => [provider.id, provider]));

  const toolsByProvider = new Map<string, string[]>();
  for (const tool of listTools()) {
    if (!tool.providerId) {
      continue;
    }
    const names = toolsByProvider.get(tool.providerId) ?? [];
    names.push(tool.name);
    toolsByProvider.set(tool.providerId, names);
  }

  const awareness: IntegrationAwareness = { connected: [], available: [], unavailable: [] };
  for (const [providerId, toolNames] of toolsByProvider) {
    const def = providerById.get(providerId);
    const label = def?.label ?? providerId;
    const group: ProviderGroup = {
      providerId,
      label,
      tools: toolNames.sort(),
    };
    const record = connected.get(providerId);
    if (record) {
      group.accountName = record.accountName;
      awareness.connected.push(group);
    } else if (def?.type === 'oauth' && !def.oauthConfigured) {
      awareness.unavailable.push(group);
    } else {
      awareness.available.push(group);
    }
  }

  awareness.connected.sort((a, b) => a.label.localeCompare(b.label));
  awareness.available.sort((a, b) => a.label.localeCompare(b.label));
  awareness.unavailable.sort((a, b) => a.label.localeCompare(b.label));
  return awareness;
}

function groupLines(groups: ProviderGroup[]): string[] {
  return groups.map((group) => {
    const account = group.accountName ? ` (${group.accountName})` : '';
    return `- ${group.label}${account}: ${group.tools.join(', ')}`;
  });
}

/**
 * Renders the awareness data as a compact system-prompt section. Returns an
 * empty string when there is nothing to report, so the base prompt is untouched
 * for users with no integration-backed tools.
 */
export function formatIntegrationAwareness(awareness: IntegrationAwareness): string {
  const sections: string[] = [];

  if (awareness.connected.length > 0) {
    sections.push(
      "Connected accounts you can act on directly (use their tools to fetch data or perform actions on the user's behalf):\n" +
        groupLines(awareness.connected).join('\n'),
    );
  }

  if (awareness.available.length > 0) {
    sections.push(
      'Accounts the user can connect but has NOT connected yet. If the user asks for something that ' +
        'needs one of these, do NOT call its tools. Instead reply that you need permission to connect ' +
        'their account and name the service, and the interface will offer a Connect button:\n' +
        groupLines(awareness.available).join('\n'),
    );
  }

  if (awareness.unavailable.length > 0) {
    sections.push(
      'Services whose tools exist but cannot be connected right now (server not configured). If asked ' +
        'about them, explain they are not available yet:\n' +
        groupLines(awareness.unavailable).join('\n'),
    );
  }

  return sections.length > 0
    ? 'Your connected capabilities (from your integrations):\n' + sections.join('\n\n')
    : '';
}
