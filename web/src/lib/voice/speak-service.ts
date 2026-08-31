/**
 * Central speech service (TTS) for BRO replies.
 *
 * Unlike the raw `speak()` in `lib/speech.ts` (browser speechSynthesis only and
 * notoriously unreliable in Electron), this service prefers a server-side
 * ElevenLabs synthesis route that returns an MP3, then plays it through an
 * <audio> element. That path works identically in the plain browser and inside
 * Electron where `speechSynthesis` often produces no audio. When ElevenLabs is
 * not configured it falls back to the browser's native speechSynthesis.
 *
 * The service is a singleton so multiple chat surfaces (chat, overlay, voice)
 * can auto-read replies aloud without overlapping or double-speaking.
 */

import { API_BASE_URL } from '@/lib/api';
import { getAccessToken } from '@/lib/token-store';
import { speak as nativeSpeak, stopSpeaking as nativeStop, stripMarkdown } from '@/lib/speech';

type SpeakOptions = {
  /** Prefer the backend (ElevenLabs) engine even when synthesis is available. */
  preferProvider?: boolean;
  /** TTS voice name for the native fallback. */
  voice?: string | null;
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
  /** Force the native (browser) engine. */
  forceNative?: boolean;
};

class SpeakService {
  private audio = typeof Audio !== 'undefined' ? new Audio() : null;
  private playing = false;
  private cancelled = false;
  private pendingCancel: (() => void) | null = null;
  private pendingAbort: (() => void) | null = null;

  constructor() {
    if (this.audio) {
      this.audio.preload = 'auto';
    }
  }

  /** Whether any speech is currently being played. */
  isPlaying(): boolean {
    return this.playing;
  }

  /** Engines available to this runtime. */
  supports(): { provider: boolean; native: boolean } {
    return {
      provider:
        typeof Audio !== 'undefined' &&
        typeof fetch !== 'undefined' &&
        typeof API_BASE_URL === 'string',
      native: typeof window !== 'undefined' && 'speechSynthesis' in window,
    };
  }

  /** Whether BRO replies should be read aloud at all (native or provider available). */
  isSupported(): boolean {
    const s = this.supports();
    return s.provider || s.native;
  }

  /**
   * Speak a reply using the best available engine. Resolves (true) when speech
   * was started, or (false) when nothing could play (e.g. text empty or both
   * engines unavailable).
   */
  speak(text: string, options: SpeakOptions = {}): boolean {
    const content = stripMarkdown(text).trim();
    if (!content) {
      return false;
    }
    const s = this.supports();
    const useProvider = s.provider && !options.forceNative && (options.preferProvider || !s.native);

    if (useProvider) {
      this.playProvider(content, options);
      return true;
    }
    if (s.native) {
      nativeSpeak(content, {
        voice: options.voice ?? null,
        rate: options.rate ?? 1,
        pitch: options.pitch ?? 1,
        onEnd: options.onEnd,
      });
      this.playing = true;
      return true;
    }
    return false;
  }

  /** Stop any in-progress speech (both engines). */
  stop(): void {
    this.cancelled = true;
    this.playing = false;
    nativeStop();
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
    }
    if (this.pendingCancel) {
      try {
        this.pendingCancel();
      } catch {
        // ignore
      }
      this.pendingCancel = null;
    }
  }
  private playProvider(content: string, options: SpeakOptions): void {
    const finish = (): void => {
      if (this.pendingCancel === this.pendingAbort) {
        this.pendingCancel = null;
      }
      this.playing = false;
      options.onEnd?.();
    };
    if (!this.audio) {
      this.fallbackNative(content, options, finish);
      return;
    }
    this.stop();
    this.cancelled = false;
    this.playing = true;

    const token = getAccessToken();
    const url = `${API_BASE_URL}/audio/speak?text=${encodeURIComponent(content)}`;

    const controller = new AbortController();
    this.pendingAbort = () => controller.abort();
    this.pendingCancel = this.pendingAbort;

    this.audio.src = '';
    void fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          return this.fallbackNative(content, options, finish);
        }
        return response.blob().then((blob) => {
          if (this.cancelled) {
            finish();
            return;
          }
          const url = URL.createObjectURL(blob);
          const ended = (): void => {
            this.audio!.removeEventListener('ended', ended);
            this.audio!.removeEventListener('error', ended);
            URL.revokeObjectURL(url);
            this.audio!.src = '';
            finish();
          };
          this.audio!.addEventListener('ended', ended);
          this.audio!.addEventListener('error', ended);
          this.audio!.src = url;
          this.audio!.play().catch(() => {
            ended();
          });
        });
      })
      .catch(() => {
        this.fallbackNative(content, options, finish);
      });
  }

  private fallbackNative(content: string, options: SpeakOptions, finish: () => void): void {
    if (this.cancelled) {
      finish();
      return;
    }
    if (!('speechSynthesis' in window)) {
      finish();
      return;
    }
    nativeSpeak(content, {
      voice: options.voice ?? null,
      rate: options.rate ?? 1,
      pitch: options.pitch ?? 1,
      onEnd: finish,
    });
  }
}

export const speakService = new SpeakService();

export type { SpeakOptions };

/** Convenience: speak via the shared service. */
export function speakAloud(text: string, options?: SpeakOptions): boolean {
  return speakService.speak(text, options);
}

/** Convenience: stop the shared service. */
export function stopSpeaking(): void {
  speakService.stop();
}
