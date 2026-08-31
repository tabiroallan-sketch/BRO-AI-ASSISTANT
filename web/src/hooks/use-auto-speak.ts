'use client';

import * as React from 'react';
import { speakService } from '@/lib/voice/speak-service';
import { initVoiceSettings } from '@/lib/voice/settings';
import type { VoiceSettings } from '@/lib/desktop';
import { useVoice } from '@/hooks/use-voice';

export type UseAutoSpeakResult = {
  /** Read an assistant reply aloud if TTS is enabled. Returns whether speech started. */
  speakReply: (content: string) => boolean;
  /** Read the reply aloud regardless of the TTS enable flag (manual "read aloud"). */
  speakReplyForced: (content: string) => boolean;
  /** Stop any in-progress speech. */
  stopSpeaking: () => void;
  /** Whether speech is currently playing. */
  isSpeaking: boolean;
  /** Current TTS engine availability. */
  supported: boolean;
};

/**
 * Adds BRO's spoken replies to a chat surface. Reads the user's voice settings
 * (TTS on/off, voice, speed) and plays each assistant reply through the shared
 * speak service, which prefers server-side ElevenLabs audio (works in the plain
 * browser and Electron) and falls back to the browser's speechSynthesis.
 */
export function useAutoSpeak(): UseAutoSpeakResult {
  const voice = useVoice();
  const [settings, setSettings] = React.useState<VoiceSettings | null>(null);
  const [isSpeaking, setIsSpeaking] = React.useState(false);
  const settingsRef = React.useRef<VoiceSettings | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void initVoiceSettings().then((loaded) => {
      if (!cancelled) {
        settingsRef.current = loaded;
        setSettings(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the UI in sync with the shared playback state without any global
  // subscription API: poll the cheap getter on an interval, and also flip it
  // optimistically on start/stop so the indicator feels instant.
  React.useEffect(() => {
    const id = window.setInterval(() => {
      setIsSpeaking(speakService.isPlaying());
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  const stopSpeaking = React.useCallback(() => {
    speakService.stop();
    setIsSpeaking(false);
  }, []);

  const speakReply = React.useCallback(
    (content: string): boolean => {
      const enabled = settingsRef.current?.ttsEnabled;
      if (enabled === false || voice.state.mode === 'off') {
        return false;
      }
      const ok = speakService.speak(content, {
        voice: settingsRef.current?.ttsVoice ?? null,
        rate: settingsRef.current?.ttsRate ?? 1,
        pitch: settingsRef.current?.ttsPitch ?? 1,
        preferProvider: true,
        onEnd: () => setIsSpeaking(false),
      });
      setIsSpeaking(ok);
      return ok;
    },
    [voice.state.mode],
  );

  const speakReplyForced = React.useCallback((content: string): boolean => {
    const ok = speakService.speak(content, {
      voice: settingsRef.current?.ttsVoice ?? null,
      rate: settingsRef.current?.ttsRate ?? 1,
      pitch: settingsRef.current?.ttsPitch ?? 1,
      preferProvider: true,
      forceNative: false,
      onEnd: () => setIsSpeaking(false),
    });
    setIsSpeaking(ok);
    return ok;
  }, []);

  return {
    speakReply,
    speakReplyForced,
    stopSpeaking,
    isSpeaking,
    supported: settings ? speakService.isSupported() : true,
  };
}
