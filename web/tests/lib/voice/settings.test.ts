import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_SETTINGS } from '@/lib/desktop';

type SettingsModule = typeof import('@/lib/voice/settings');

function stubLocalStore(initial: string | null = null): {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>();
  if (initial !== null) {
    store.set('bro.voice.settings.v1', initial);
  }
  const getItem = vi.fn((key: string) => store.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => {
    store.set(key, value);
  });
  vi.stubGlobal('localStorage', {
    getItem,
    setItem,
    removeItem: vi.fn(),
    clear: vi.fn(),
  });
  return { getItem, setItem };
}

async function freshSettings(): Promise<SettingsModule> {
  vi.resetModules();
  return await import('@/lib/voice/settings');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('voice settings persistence', () => {
  it('returns defaults when nothing is stored', async () => {
    const { currentVoiceSettings } = await freshSettings();
    expect(currentVoiceSettings()).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it('saves a patch to localStorage and the cache', async () => {
    const { setItem } = stubLocalStore();
    const { currentVoiceSettings, saveVoiceSettings } = await freshSettings();

    await saveVoiceSettings({ ttsRate: 1.5 });
    expect(currentVoiceSettings().ttsRate).toBe(1.5);
    expect(setItem).toHaveBeenCalledWith(
      'bro.voice.settings.v1',
      expect.stringContaining('"ttsRate":1.5'),
    );
  });

  it('clamps out-of-range values on save', async () => {
    stubLocalStore();
    const { currentVoiceSettings, saveVoiceSettings } = await freshSettings();

    await saveVoiceSettings({ ttsRate: 9, ttsPitch: -3 });
    expect(currentVoiceSettings().ttsRate).toBe(2);
    expect(currentVoiceSettings().ttsPitch).toBe(0);
  });

  it('loads persisted values from localStorage', async () => {
    stubLocalStore(JSON.stringify({ ...DEFAULT_VOICE_SETTINGS, ttsRate: 1.25 }));
    const { initVoiceSettings } = await freshSettings();

    const loaded = await initVoiceSettings();
    expect(loaded.ttsRate).toBe(1.25);
    expect(loaded.listeningMode).toBe(DEFAULT_VOICE_SETTINGS.listeningMode);
  });

  it('prefers desktop config and writes saves back through the bridge', async () => {
    stubLocalStore();
    const configSet = vi.fn(async (patch: unknown) => patch);
    vi.stubGlobal('window', {
      broDesktop: {
        config: {
          get: async () => ({
            voice: { ...DEFAULT_VOICE_SETTINGS, listeningMode: 'ptt' },
          }),
          set: configSet,
        },
      },
    });
    const { initVoiceSettings, saveVoiceSettings } = await freshSettings();

    const loaded = await initVoiceSettings();
    expect(loaded.listeningMode).toBe('ptt');

    await saveVoiceSettings({ ttsEnabled: false });
    expect(configSet).toHaveBeenCalledWith({
      voice: expect.objectContaining({ ttsEnabled: false, listeningMode: 'ptt' }),
    });
  });

  it('ignores a corrupt localStorage payload', async () => {
    stubLocalStore('{ not json');
    const { currentVoiceSettings } = await freshSettings();
    expect(currentVoiceSettings()).toEqual(DEFAULT_VOICE_SETTINGS);
  });
});
