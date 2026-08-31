import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { speakService, speakAloud, stopSpeaking } from '@/lib/voice/speak-service';

type AudioStub = {
  preload: string;
  src: string;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
};

function makeAudio(this: AudioStub): void {
  this.preload = '';
  this.src = '';
  this.pause = vi.fn();
  this.play = vi.fn(() => Promise.resolve());
}

beforeAll(() => {
  vi.stubGlobal('Audio', makeAudio);
});

afterEach(() => {
  speakService.stop();
  vi.unstubAllGlobals();
  vi.stubGlobal('Audio', makeAudio);
});

function stubNative() {
  const utterance = { onend: null as (() => void) | null, onerror: null as (() => void) | null };
  const cancel = vi.fn();
  const nativeSpeak = vi.fn((u: { onend: null | (() => void) }) => {
    utterance.onend = u.onend;
  });
  vi.stubGlobal('window', { speechSynthesis: { cancel, speak: nativeSpeak, getVoices: () => [] } });
  vi.stubGlobal('SpeechSynthesisUtterance', function SpeechSynthesisUtterance() {
    return utterance;
  });
  return { cancel, nativeSpeak, utterance };
}

describe('speak-service fallback', () => {
  it('falls back to native speechSynthesis when the provider is unavailable', async () => {
    const { nativeSpeak, utterance } = stubNative();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network'))),
    );
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:x') });

    const ok = speakAloud('Hello there', {
      preferProvider: true,
      onEnd: () => {},
    });

    expect(ok).toBe(true);
    // The provider request is async; allow the rejection to reach the fallback.
    await vi.waitFor(() => expect(nativeSpeak).toHaveBeenCalled());
    expect(utterance.onend).not.toBeNull();
  });

  it('returns false for empty or markdown-only text', () => {
    expect(speakAloud('')).toBe(false);
    expect(speakAloud('   ')).toBe(false);
  });
});

describe('speak-service stop/state', () => {
  it('tracks isPlaying and resets on stop', () => {
    const { cancel } = stubNative();

    const ok = speakAloud('Hi');
    expect(ok).toBe(true);
    expect(speakService.isPlaying()).toBe(true);

    stopSpeaking();
    expect(speakService.isPlaying()).toBe(false);
    expect(cancel).toHaveBeenCalled();
  });
});
