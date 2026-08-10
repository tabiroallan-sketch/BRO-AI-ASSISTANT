/**
 * Server-side audio transcription (replaces the in-app Web Speech API path).
 *
 * The microphone blob is decoded to 16 kHz mono PCM, re-encoded as WAV, and
 * POSTed to the Bro API `/audio/transcribe` endpoint, which forwards it to the
 * configured LLM provider (Gemini accepts inline audio parts). Works inside
 * Electron where `webkitSpeechRecognition` is unavailable/broken.
 */

import { request } from '@/lib/api';

export type TranscribeFormat = 'wav' | 'mp3' | 'aiff' | 'aac' | 'ogg' | 'flac';

/**
 * Whether the transcription backend is usable in this environment. The recorder
 * itself only needs MediaRecorder + FileReader; the actual round-trip to the
 * API decides reachability at runtime.
 */
export function isTranscriptionSupported(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof FileReader !== 'undefined' &&
    typeof AudioContext !== 'undefined'
  );
}

function encodePcmToWav(pcm: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

async function decodeToWav(blob: Blob): Promise<Blob> {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) {
    throw new Error('Audio decoding is not available in this app');
  }
  const context = new Ctor({ sampleRate: 16_000 });
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await context.decodeAudioData(arrayBuffer);
    const pcm = audioBuffer.getChannelData(0);
    const wav = encodePcmToWav(pcm, audioBuffer.sampleRate);
    return new Blob([wav], { type: 'audio/wav' });
  } finally {
    void context.close();
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read audio'));
    reader.readAsDataURL(blob);
  });
}

/** Transcribes a recorded utterance via the Bro API. Returns trimmed text. */
export async function transcribeAudio(blob: Blob): Promise<string> {
  const wav = await decodeToWav(blob);
  const audio = await blobToBase64(wav);
  const result = await request<{ text: string }>('/audio/transcribe', {
    method: 'POST',
    body: { audio, format: 'wav' },
  });
  return (result?.text ?? '').trim();
}
