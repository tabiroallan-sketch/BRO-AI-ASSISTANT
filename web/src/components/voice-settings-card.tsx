'use client';

import * as React from 'react';
import { AudioLines, Loader2, Radar } from 'lucide-react';
import { useVoice } from '@/hooks/use-voice';
import {
  VOICE_MODE_LABELS,
  VOICE_MODES,
  WAKE_WORD_MAX_PHRASES,
  WAKE_WORD_MAX_SENSITIVITY,
  WAKE_WORD_MIN_SENSITIVITY,
  getDesktopApi,
  normalizeVoiceSettings,
  normalizeWakePhrases,
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
  const [requesting, setRequesting] = React.useState(false);
  const [requestFailed, setRequestFailed] = React.useState(false);

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
      voice.wakeEngine.applySettings(next);
    } finally {
      setSaving(false);
    }
  }

  function commitPhrases(raw: string): void {
    const phrases = normalizeWakePhrases(
      raw
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
    void update({ wakeWordPhrases: phrases });
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

  /** OS mic-privacy deep link, when running inside the desktop shell. */
  function micSettingsUrl(): string | null {
    if (!api) {
      return null;
    }
    if (api.platform === 'win32') {
      return 'ms-settings:privacy-microphone';
    }
    if (api.platform === 'darwin') {
      return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
    }
    return null;
  }

  /**
   * Re-requests the microphone inside a fresh user gesture. A grant here makes
   * the browser prompt again (unless it was permanently blocked) and re-arms
   * the wake engine so the status flips straight back to "armed".
   */
  async function requestMicPermission(): Promise<void> {
    setRequesting(true);
    setRequestFailed(false);
    try {
      const mic = createMicManager();
      let granted = false;
      if (mic.supported()) {
        try {
          await mic.acquire({ deviceId: settings?.inputDeviceId ?? null });
          mic.release();
          granted = true;
        } catch {
          granted = false;
        }
      }
      if (granted && settings) {
        voice.engine.applySettings(settings);
        voice.wakeEngine.applySettings(settings);
      } else {
        setRequestFailed(true);
      }
    } finally {
      setRequesting(false);
    }
  }

  async function openSystemMicSettings(): Promise<void> {
    const url = micSettingsUrl();
    if (api && url) {
      await api.shell.openExternal(url);
    }
  }

  const disabled = !settings;

  const wake = voice.wake;
  let wakeStatus = 'Wake word is off.';
  if (!settings?.wakeWordEnabled) {
    wakeStatus = 'Wake word is off.';
  } else if (!wake.supported) {
    wakeStatus = wake.error ?? 'Wake word needs voice transcription.';
  } else if (!voice.wakeOwner) {
    wakeStatus = 'Paused — another BRO window is listening.';
  } else if (voice.isListening) {
    wakeStatus = 'Listening…';
  } else if (wake.phase === 'hearing') {
    wakeStatus = 'Speech detected — listening for the wake phrase…';
  } else if (wake.phase === 'armed') {
    wakeStatus = `Listening for “${settings.wakeWordPhrases.join('”, “')}”…`;
  } else if (wake.phase === 'triggered') {
    wakeStatus = 'Wake word heard — listening.';
  } else if (wake.phase === 'paused') {
    wakeStatus = 'Paused.';
  } else if (wake.phase === 'error') {
    wakeStatus = wake.error ?? 'Wake word is unavailable.';
  }

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

            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between gap-4">
                {rowLabel(
                  'Wake word',
                  'Say "hey bro" hands-free to start listening. Runs in a single window; the mic stays active while armed.',
                )}
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.wakeWordEnabled}
                    onChange={(event) => void update({ wakeWordEnabled: event.target.checked })}
                    className="h-4 w-4 accent-neon-cyan"
                  />
                  Enabled
                </label>
              </div>

              <div
                className={cn(
                  'space-y-3',
                  !settings.wakeWordEnabled && 'pointer-events-none opacity-50',
                )}
              >
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm">
                  <Radar className="h-4 w-4 shrink-0 text-neon-cyan" />
                  <span>{wakeStatus}</span>
                </div>

                {wake.phase === 'error' && wake.supported && wake.micError && (
                  <div className="space-y-2 rounded-md border border-border bg-muted p-3">
                    {requesting ? (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Requesting microphone
                        permission…
                      </p>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void requestMicPermission()}
                          >
                            Request microphone permission
                          </Button>
                          {micSettingsUrl() && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void openSystemMicSettings()}
                            >
                              Open system mic settings
                            </Button>
                          )}
                        </div>
                        {requestFailed && (
                          <p className="text-xs text-muted-foreground">
                            Still blocked. Allow the microphone for this browser and in your system
                            privacy settings, then try again.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}

                {(wake.phase === 'armed' || wake.phase === 'hearing') && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-neon-cyan transition-[width] duration-150"
                      style={{ width: `${Math.max(6, wake.level * 100)}%` }}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between gap-4">
                  {rowLabel(
                    'Phrases',
                    `Comma-separated, up to ${WAKE_WORD_MAX_PHRASES}; say any of these to wake BRO.`,
                  )}
                  <input
                    type="text"
                    defaultValue={settings.wakeWordPhrases.join(', ')}
                    onBlur={(event) => commitPhrases(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        commitPhrases((event.target as HTMLInputElement).value);
                      }
                    }}
                    className="h-9 w-48 rounded-md border border-border bg-muted px-2 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-neon-cyan"
                    aria-label="Wake word phrases"
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  {rowLabel(
                    'Sensitivity',
                    `${settings.wakeWordSensitivity.toFixed(2)} — higher needs a clearer, stabler match.`,
                  )}
                  <input
                    type="range"
                    min={WAKE_WORD_MIN_SENSITIVITY}
                    max={WAKE_WORD_MAX_SENSITIVITY}
                    step={0.05}
                    value={settings.wakeWordSensitivity}
                    onChange={(event) =>
                      void update({ wakeWordSensitivity: Number(event.target.value) })
                    }
                    className="w-40 accent-neon-cyan"
                    aria-label="Wake word sensitivity"
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  {rowLabel('Audible feedback', 'Play a chime when the wake word is heard.')}
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={settings.wakeWordFeedback}
                      onChange={(event) => void update({ wakeWordFeedback: event.target.checked })}
                      className="h-4 w-4 accent-neon-cyan"
                    />
                    Chime
                  </label>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
