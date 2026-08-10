/**
 * MediaRecorder-based speech recognizer that swaps the (unavailable/broken)
 * Web Speech API for record -> decode -> API transcription. `start()` begins
 * recording the shared microphone stream; `stop()` ends it and fires
 * `onFinal`/`onEnd` once the transcript arrives. If the clip exceeds the max
 * duration it stops itself so a transcript is always produced.
 */

import type { SpeechRecognizer, SpeechRecognizerOptions } from '@/lib/speech';
import { isTranscriptionSupported, transcribeAudio } from './transcribe';

const DEFAULT_MAX_DURATION_MS = 45_000;

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];

function pickMimeType(): string {
  if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
    for (const candidate of MIME_CANDIDATES) {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    }
  }
  return 'audio/webm';
}

export function createTranscribeRecognizer(
  stream: MediaStream,
  options: SpeechRecognizerOptions,
  maxDurationMs: number = DEFAULT_MAX_DURATION_MS,
): SpeechRecognizer | null {
  if (!isTranscriptionSupported()) {
    return null;
  }

  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let listening = false;
  let finalizing = false;
  let durationTimer: ReturnType<typeof setTimeout> | null = null;

  function stopRecording(): void {
    if (durationTimer) {
      clearTimeout(durationTimer);
      durationTimer = null;
    }
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }

  async function finalize(): Promise<void> {
    if (finalizing) {
      return;
    }
    finalizing = true;
    const blob = chunks.length > 0 ? new Blob(chunks, { type: chunks[0].type }) : new Blob();
    chunks = [];
    try {
      const text = await transcribeAudio(blob);
      if (text) {
        options.onFinal(text);
      }
    } catch (error) {
      options.onError(error instanceof Error ? error.message : String(error));
    } finally {
      listening = false;
      options.onEnd();
    }
  }

  function beginRecording(): void {
    chunks = [];
    finalizing = false;
    let mediaRecorder: MediaRecorder;
    try {
      mediaRecorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
    } catch {
      mediaRecorder = new MediaRecorder(stream);
    }
    recorder = mediaRecorder;
    mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    mediaRecorder.onstop = () => {
      void finalize();
    };
    mediaRecorder.onerror = () => {
      if (!finalizing) {
        listening = false;
        options.onError('Recording failed');
      }
    };
    mediaRecorder.start(1000);
  }

  return {
    start: () => {
      if (listening) {
        return;
      }
      listening = true;
      beginRecording();
      durationTimer = setTimeout(() => {
        stopRecording();
      }, maxDurationMs);
    },
    stop: () => {
      if (!listening) {
        return;
      }
      stopRecording();
    },
    isListening: () => listening,
  };
}
