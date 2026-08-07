import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_DESKTOP_CONFIG, type DesktopConfig } from '../shared/desktop-api.js';

/**
 * Persists the desktop configuration as JSON in the userData directory.
 * Writes are atomic (temp file + rename) so a crash mid-write cannot corrupt
 * the config. Reads merge over the defaults so new keys appear automatically.
 */
export class ConfigStore {
  private readonly filePath: string;
  private cache: DesktopConfig | null = null;

  constructor(options: { filePath: string }) {
    this.filePath = options.filePath;
  }

  get path(): string {
    return this.filePath;
  }

  async get(): Promise<DesktopConfig> {
    if (this.cache) {
      return this.cache;
    }
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch {
      this.cache = { ...DEFAULT_DESKTOP_CONFIG };
      return this.cache;
    }
    let parsed: Partial<DesktopConfig> = {};
    try {
      parsed = JSON.parse(raw) as Partial<DesktopConfig>;
    } catch {
      // Corrupt or partial file: fall back to defaults rather than crashing.
      parsed = {};
    }
    this.cache = { ...DEFAULT_DESKTOP_CONFIG, ...parsed };
    return this.cache;
  }

  async set(patch: Partial<DesktopConfig>): Promise<DesktopConfig> {
    const next = { ...(await this.get()), ...patch };
    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, serialized, 'utf8');
    renameSync(tempPath, this.filePath);
    this.cache = next;
    return next;
  }
}
