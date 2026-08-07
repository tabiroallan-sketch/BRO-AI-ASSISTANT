'use client';

import * as React from 'react';
import { AudioLines, Loader2 } from 'lucide-react';
import { useVoice } from '@/hooks/use-voice';
import {
  VOICE_MODE_LABELS,
  VOICE_MODES,
  getDesktopApi,
  normalizeVoiceSettings,
  type VoiceSettings,
} from '@/lib/desktop';
import { initVoiceSettings, saveVoiceSettings } from '@/lib/voice/settings';
import { createMicManager, type AudioDeviceInfo } from '@/lib/voice/mic';
import { getVoices, speak, type SpeechVoice } from '@/lib/speech';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function rowLabel(title: string, hint?: string): React.JSX.Element {
  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 rounded-md border border-border bg-muted px-2 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-neon-cyan"
    >
      {children}
    </select>
  );
}

/**
 * Voice settings (Stage 5): listening mode, mic/output devices, TTS voice and
 * pacing, and input processing. Works in the desktop shell (persisted to
 * config) and in a plain browser (localStorage fallback).
 */
export function VoiceSettingsCard(): React.JSX.Element {
  const api = getDesktopApi();
  const voice = useVoice();
  const [settings, setSettings] = React.useState<VoiceSettings | null>(null);
  const [inputDevices, setInputDevices] = React.useState<AudioDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = React.useState<AudioDeviceInfo[]>([]);
  const [voices, setVoices] = React.useState<SpeechVoice[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [tested, setTested] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void initVoiceSettings().then((loaded) => {
      if (!cancelled) {
        setSettings(loaded);
      }
    });
    const mic = createMicManager();
    if (mic.supported()) {
      void mic
        .listDevices()
        .then(({ inputs, outputs }) => {
          if (!cancelled) {
            setInputDevices(inputs);
            setOutputDevices(outputs);
          }
        })
        .catch(() => {
          // Device enumeration needs permission; leave the lists empty.
        });
    }
    const refreshVoices = (): void => {
      if (!cancelled) {
        setVoices(getVoices());
      }
    };
    refreshVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
    }
    return () => {
      cancelled = true;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.removeEventListener?.('voiceschanged', refreshVoices);
      }
    };
  }, []);

  // Reflect voice changes made in the other window (overlay / shell).
  React.useEffect(() => {
    if (!api) {
      return;
    }
    return api.config.onChanged((config) => {
      const next = normalizeVoiceSettings(config.voice);
      if (next) {
        setSettings(next);
      }
    });
  }, [api]);

  async function update(patch: Partial<VoiceSettings>): Promise<void> {
    setSaving(true);
    try {
      const next = await saveVoiceSettings(patch);
      setSettings(next);
      voice.engine.applySettings(next);
    } finally {
      setSaving(false);
    }
  }

  function testVoice(): void {
    setTested(true);
    if (settings) {
      speak('Hello, this is BRO.', {
        voice: settings.ttsVoice,
        rate: settings.ttsRate,
        pitch: settings.ttsPitch,
      });
    }
  }

  const disabled = !settings;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AudioLines className="h-4 w-4" /> Voice
        </CardTitle>
        <CardDescription>
          Listening mode, microphone, and how BRO reads replies aloud. When listening, silence
          finalizes your utterance; push-to-talk sends it straight to the chat.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {disabled ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading voice settings…
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              {rowLabel(
                'Listening mode',
                voice.state.mode === 'off'
                  ? 'Voice input is disabled until you pick a mode.'
                  : voice.state.mode === 'ptt'
                    ? 'Hold the push-to-talk shortcut to speak.'
                    : 'Tap the mic button (or Ctrl+Shift+M) to speak.',
              )}
              <div className="flex shrink-0 gap-1">
                {VOICE_MODES.map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    size="sm"
                    variant={voice.state.mode === mode ? 'default' : 'outline'}
                    disabled={saving}
                    onClick={() => void update({ listeningMode: mode })}
                  >
                    {VOICE_MODE_LABELS[mode]}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              {rowLabel('Microphone', 'The device the overlay and chat listen through.')}
              <Select
                value={settings.inputDeviceId ?? ''}
                onChange={(value) => void update({ inputDeviceId: value || null })}
              >
                <option value="">Default (system)</option>
                {inputDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microphone ${index + 1}`}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex items-center justify-between gap-4">
              {rowLabel('Speaker')}
              <Select
                value={settings.outputDeviceId ?? ''}
                onChange={(value) => void update({ outputDeviceId: value || null })}
              >
                <option value="">Default (system)</option>
                {outputDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Speaker ${index + 1}`}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between gap-4">
                {rowLabel('Read replies aloud', 'TTS via the browser voice engine.')}
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.ttsEnabled}
                    onChange={(event) => void update({ ttsEnabled: event.target.checked })}
                    className="h-4 w-4 accent-neon-cyan"
                  />
                  Enabled
                </label>
              </div>

              <div
                className={cn(
                  'space-y-3',
                  !settings.ttsEnabled && 'pointer-events-none opacity-50',
                )}
              >
                <div className="flex items-center justify-between gap-4">
                  {rowLabel('Voice')}
                  <Select
                    value={settings.ttsVoice ?? ''}
                    onChange={(value) => void update({ ttsVoice: value || null })}
                  >
                    <option value="">Default</option>
                    {voices.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name} ({item.lang})
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-4">
                  {rowLabel('Speed', String(settings.ttsRate.toFixed(1) + 'x'))}
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.1}
                    value={settings.ttsRate}
                    onChange={(event) => void update({ ttsRate: Number(event.target.value) })}
                    className="w-40 accent-neon-cyan"
                    aria-label="Speech rate"
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  {rowLabel('Pitch', settings.ttsPitch.toFixed(1))}
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.1}
                    value={settings.ttsPitch}
                    onChange={(event) => void update({ ttsPitch: Number(event.target.value) })}
                    className="w-40 accent-neon-cyan"
                    aria-label="Speech pitch"
                  />
                </div>

                <div className="flex items-center justify-end gap-3">
                  {tested && (
                    <span className="text-xs text-muted-foreground">Try again after changes.</span>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={testVoice}>
                    Test voice
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2 border-t pt-4">
              {rowLabel('Input processing', 'Applied to the microphone stream when listening.')}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.noiseSuppression}
                  onChange={(event) => void update({ noiseSuppression: event.target.checked })}
                  className="h-4 w-4 accent-neon-cyan"
                />
                Noise suppression
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.echoCancellation}
                  onChange={(event) => void update({ echoCancellation: event.target.checked })}
                  className="h-4 w-4 accent-neon-cyan"
                />
                Echo cancellation
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.autoGainControl}
                  onChange={(event) => void update({ autoGainControl: event.target.checked })}
                  className="h-4 w-4 accent-neon-cyan"
                />
                Auto gain control
              </label>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
