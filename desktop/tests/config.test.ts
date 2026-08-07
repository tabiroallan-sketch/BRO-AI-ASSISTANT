import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigStore } from '../src/main/config.js';
import {
  DEFAULT_DESKTOP_CONFIG,
  DEFAULT_VOICE_SETTINGS,
  normalizeVoiceSettings,
} from '../src/shared/desktop-api.js';

function tempFile(name = 'config.json'): string {
  const dir = mkdtempSync(join(tmpdir(), 'bro-config-'));
  return join(dir, name);
}

describe('ConfigStore', () => {
  it('returns defaults when the file is missing', async () => {
    const store = new ConfigStore({ filePath: tempFile() });
    await expect(store.get()).resolves.toEqual(DEFAULT_DESKTOP_CONFIG);
  });

  it('merges partial files over the defaults', async () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ closeToTray: true }), 'utf8');
    const store = new ConfigStore({ filePath: file });
    const config = await store.get();
    expect(config.closeToTray).toBe(true);
    expect(config.theme).toBe(DEFAULT_DESKTOP_CONFIG.theme);
    expect(config.launchAtLogin).toBe(DEFAULT_DESKTOP_CONFIG.launchAtLogin);
  });

  it('falls back to defaults on a corrupt file', async () => {
    const file = tempFile();
    writeFileSync(file, 'not json {', 'utf8');
    const store = new ConfigStore({ filePath: file });
    await expect(store.get()).resolves.toEqual(DEFAULT_DESKTOP_CONFIG);
  });

  it('persists a patch and returns the merged result', async () => {
    const file = tempFile();
    const store = new ConfigStore({ filePath: file });
    const next = await store.set({ theme: 'dark', browserEnabled: true });
    expect(next.theme).toBe('dark');
    expect(next.browserEnabled).toBe(true);

    const reloaded = new ConfigStore({ filePath: file });
    const config = await reloaded.get();
    expect(config.theme).toBe('dark');
    expect(config.browserEnabled).toBe(true);
    expect(config.closeToTray).toBe(DEFAULT_DESKTOP_CONFIG.closeToTray);
  });

  it('writes atomically (no stray temp file left behind)', async () => {
    const file = tempFile();
    const store = new ConfigStore({ filePath: file });
    await store.set({ closeToTray: true });
    const dir = file.slice(0, file.lastIndexOf('\\') + 1);
    const leftovers = readFileSync(file, 'utf8');
    expect(leftovers).toContain('"closeToTray": true');
    expect(() => rmSync(dir, { recursive: true })).not.toThrow();
  });
});

describe('voice settings', () => {
  it('merges a full voice patch over the defaults', async () => {
    const file = tempFile();
    const store = new ConfigStore({ filePath: file });
    const next = await store.set({ voice: { ...DEFAULT_VOICE_SETTINGS, ttsRate: 1.5 } });
    expect(next.voice.ttsRate).toBe(1.5);
    expect(next.voice.listeningMode).toBe(DEFAULT_DESKTOP_CONFIG.voice.listeningMode);
    expect(next.closeToTray).toBe(DEFAULT_DESKTOP_CONFIG.closeToTray);
  });

  it('normalizes and clamps out-of-range tts values', () => {
    const voice = normalizeVoiceSettings({
      ...DEFAULT_VOICE_SETTINGS,
      listeningMode: 'ptt',
      ttsRate: 9,
      ttsPitch: -2,
      noiseSuppression: false,
    });
    expect(voice).toMatchObject({
      listeningMode: 'ptt',
      ttsRate: 2,
      ttsPitch: 0,
      noiseSuppression: false,
    });
  });

  it('rejects voice settings with an invalid listening mode', () => {
    expect(
      normalizeVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, listeningMode: 'shout' }),
    ).toBeUndefined();
  });

  it('rejects voice settings that are missing required fields', () => {
    expect(normalizeVoiceSettings({ listeningMode: 'manual' })).toBeUndefined();
  });
});
