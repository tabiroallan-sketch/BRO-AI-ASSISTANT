import { z } from 'zod';
import type { BroPlugin } from './types.js';

const toolParameterSchema = z.object({
  type: z.string(),
  description: z.string().optional(),
});

const toolSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  parameters: z.object({
    type: z.literal('object'),
    properties: z.record(z.string(), toolParameterSchema),
    required: z.array(z.string()).optional(),
    additionalProperties: z.boolean().optional(),
  }),
  execute: z.function(),
});

export const pluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  enabled: z.boolean().optional(),
  tools: z.array(toolSchema).optional(),
  setup: z.function().optional(),
  teardown: z.function().optional(),
});

export function validatePluginManifest(
  value: unknown,
): { ok: true; manifest: BroPlugin } | { ok: false; error: string } {
  const parsed = pluginManifestSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  return { ok: true, manifest: parsed.data as BroPlugin };
}

export function definePlugin(plugin: BroPlugin): BroPlugin {
  return plugin;
}
