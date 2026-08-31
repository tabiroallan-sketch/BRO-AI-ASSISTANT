import { config } from '../config/index.js';
import { fetchWithTimeout } from './http.js';

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM';
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const MAX_TEXT_LENGTH = 1000;

export type SpeakProvider = 'elevenlabs' | 'synthesis';

/** True when an ElevenLabs key is configured so the backend can synthesize audio. */
export function elevenLabsConfigured(): boolean {
  return Boolean(config.elevenLabsApiKey);
}

/**
 * Synthesizes speech to an MP3 binary via the ElevenLabs API.
 *
 * Returns `null` when ElevenLabs is not configured or the text is empty, so the
 * caller can fall back to the browser's native speechSynthesis.
 */
export async function synthesizeSpeech(text: string): Promise<Buffer | null> {
  if (!elevenLabsConfigured() || !text.trim()) {
    return null;
  }
  const safeText = text.slice(0, MAX_TEXT_LENGTH).trim();
  if (!safeText) {
    return null;
  }
  const response = await fetchWithTimeout(
    `${ELEVENLABS_API_BASE}/text-to-speech/${encodeURIComponent(DEFAULT_VOICE)}`,
    {
      method: 'POST',
      timeoutMs: 20_000,
      headers: {
        accept: 'audio/mpeg',
        'content-type': 'application/json',
        'xi-api-key': config.elevenLabsApiKey,
      },
      body: JSON.stringify({
        text: safeText,
        model_id: DEFAULT_MODEL,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0 },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`ElevenLabs synthesis failed with status ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
