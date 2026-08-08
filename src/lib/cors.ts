import { config } from '../config/index.js';

export function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) {
    return false;
  }
  if (config.corsOrigin === '*') {
    return true;
  }
  const normalized = normalizeOrigin(origin);
  return config.corsOrigins.some((entry) => normalizeOrigin(entry) === normalized);
}
