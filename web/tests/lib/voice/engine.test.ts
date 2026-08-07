import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_SETTINGS, type VoiceSettings } from '@/lib/desktop';
import { VoiceEngine, type EngineDeps } from '@/lib/voice/engine';
import type { VadOptions } from '@/lib/voice/vad';

function streamMock(): MediaStream {
  return { getTracks: () => [] } as unknown as MediaStream;
}

function buildEngine(overrides: Partial<EngineDeps> = {}) {
  const settings: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS };
  const recognizer = {
    start: vi.fn(),
    stop: vi.fn(),
    isListening: vi.fn(() => true),
  };
  const vad = { feed: vi.fn(), isActive: vi.fn(() => true), reset: vi.fn() };

  let recognizerOptions: Parameters<EngineDeps['sttFactory']>[0] | null = null;
  let vadOptions: VadOptions | null = null;

  const mic = {
    supported: vi.fn(() => true),
    listDevices: vi.fn(async () => ({ inputs: [], outputs: [] })),
    acquire: vi.fn(async () => streamMock()),
    release: vi.fn(),
    levelMeter:
      vi.fn<
        (stream: MediaStream, onLevel: (level: number) => void, intervalMs?: number) => () => void
      >(),
  };
  const sttFactory = vi.fn((options: Parameters<EngineDeps['sttFactory']>[0]) => {
    recognizerOptions = options;
    return recognizer;
  });
  const vadFactory = vi.fn((options: VadOptions) => {
    vadOptions = options;
    return vad;
  });

  const deps: EngineDeps = {
    mic,
    sttSupported: () => true,
    sttFactory,
    vadFactory,
    settings: () => settings,
    now: () => 0,
    ...overrides,
  };
  const engine = new VoiceEngine(deps);

  return {
    engine,
    settings,
    mic,
    recognizer,
    sttFactory,
    vadFactory,
    vad,
    getRecognizerOptions: () => recognizerOptions,
    getVadOptions: () => vadOptions,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VoiceEngine', () => {
  it('initializes from settings and capability checks', () => {
    const { engine } = buildEngine();
    const state = engine.getState();
    expect(state.phase).toBe('idle');
    expect(state.mode).toBe('manual');
    expect(state.micSupported).toBe(true);
    expect(state.sttSupported).toBe(true);
  });

  it('startManual transitions requesting -> listening and wires the mic', async () => {
    const { engine, mic, recognizer, sttFactory, vadFactory } = buildEngine();
    await engine.startManual();

    expect(mic.acquire).toHaveBeenCalledOnce();
    expect(mic.levelMeter).toHaveBeenCalledOnce();
    expect(sttFactory).toHaveBeenCalledOnce();
    expect(recognizer.start).toHaveBeenCalledOnce();
    expect(vadFactory).toHaveBeenCalledOnce();

    const state = engine.getState();
    expect(state.phase).toBe('listening');
    expect(engine.isListening()).toBe(true);
  });

  it('passes device and processing settings into acquire', async () => {
    const { engine, settings, mic } = buildEngine();
    settings.inputDeviceId = 'mic-9';
    settings.echoCancellation = false;
    await engine.startManual();
    expect(mic.acquire).toHaveBeenCalledWith({
      deviceId: 'mic-9',
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true,
    });
  });

  it('feeds live levels into the VAD and state', async () => {
    const { engine, mic, vad, getVadOptions } = buildEngine();
    await engine.startManual();

    const [, levelCallback] = mic.levelMeter.mock.calls[0];
    levelCallback(0.4);
    expect(engine.getState().level).toBe(0.4);
    expect(vad.feed).toHaveBeenCalledWith(0.4);
    expect(getVadOptions()?.onSpeechStart).toBeTypeOf('function');
  });

  it('updates interim and final transcripts from the recognizer', async () => {
    const { engine, getRecognizerOptions } = buildEngine();
    await engine.startManual();
    const options = getRecognizerOptions();

    options?.onInterim('hello ');
    expect(engine.getState().interim).toBe('hello ');
    options?.onFinal('hello world');
    expect(engine.getState().interim).toBe('');
  });

  it('finalizes a manual utterance when the VAD detects silence', async () => {
    const { engine, getRecognizerOptions, getVadOptions } = buildEngine();
    await engine.startManual();
    getRecognizerOptions()?.onFinal?.('hello world');

    getVadOptions()?.onSpeechEnd();
    expect(engine.getState().phase).toBe('idle');
    expect(engine.consumeTranscript()).toEqual({ text: 'hello world', source: 'manual' });
    expect(engine.consumeTranscript()).toBeNull();
  });

  it('does not emit an empty transcript', async () => {
    const { engine, getVadOptions } = buildEngine();
    await engine.startManual();
    getVadOptions()?.onSpeechEnd();
    expect(engine.consumeTranscript()).toBeNull();
  });

  it('stop() finalizes nothing but returns to idle', async () => {
    const { engine, recognizer } = buildEngine();
    await engine.startManual();
    engine.stop();
    expect(recognizer.stop).toHaveBeenCalled();
    expect(engine.getState().phase).toBe('idle');
    expect(engine.consumeTranscript()).toBeNull();
  });

  it('push-to-talk works in ptt mode and sends the transcript', async () => {
    const { engine, settings, getRecognizerOptions, getVadOptions } = buildEngine();
    settings.listeningMode = 'ptt';
    engine.applySettings({ ...settings });

    await engine.onPushToTalkStart();
    expect(engine.getState().phase).toBe('listening');

    getRecognizerOptions()?.onFinal?.('do the thing');
    getVadOptions()?.onSpeechEnd();
    expect(engine.consumeTranscript()).toEqual({ text: 'do the thing', source: 'ptt' });
  });

  it('push-to-talk is ignored outside ptt mode', async () => {
    const { engine, mic } = buildEngine();
    await engine.onPushToTalkStart();
    expect(mic.acquire).not.toHaveBeenCalled();
    expect(engine.getState().phase).toBe('idle');
  });

  it('push-to-talk stop finalizes without VAD silence', async () => {
    const { engine, settings, getRecognizerOptions } = buildEngine();
    settings.listeningMode = 'ptt';
    engine.applySettings({ ...settings });

    await engine.onPushToTalkStart();
    getRecognizerOptions()?.onFinal?.('short cut');
    engine.onPushToTalkStop();
    expect(engine.consumeTranscript()).toEqual({ text: 'short cut', source: 'ptt' });
  });

  it('mic toggle starts and stops manual listening', async () => {
    const { engine, mic } = buildEngine();
    engine.onMicToggle();
    expect(mic.acquire).toHaveBeenCalledOnce();
    engine.onMicToggle();
    expect(engine.getState().phase).toBe('idle');
  });

  it('mic toggle is ignored when voice input is off', () => {
    const { engine, settings, mic } = buildEngine();
    settings.listeningMode = 'off';
    engine.applySettings({ ...settings });
    engine.onMicToggle();
    expect(mic.acquire).not.toHaveBeenCalled();
  });

  it('setMode updates the mode', () => {
    const { engine } = buildEngine();
    engine.setMode('ptt');
    expect(engine.getState().mode).toBe('ptt');
    engine.setMode('ptt');
    expect(engine.getState().mode).toBe('ptt');
  });

  it('reports a mic acquisition failure as an error', async () => {
    const { engine, mic } = buildEngine();
    mic.acquire.mockRejectedValue(new Error('Permission denied'));
    await engine.startManual();
    const state = engine.getState();
    expect(state.phase).toBe('idle');
    expect(state.error).toMatch(/Permission denied/);
    expect(mic.release).toHaveBeenCalled();
  });

  it('reports when speech recognition is unavailable', async () => {
    const { engine, mic } = buildEngine({ sttFactory: () => null });
    await engine.startManual();
    const state = engine.getState();
    expect(state.phase).toBe('idle');
    expect(state.error).toMatch(/not available/);
    expect(mic.release).toHaveBeenCalled();
  });

  it('forwards recognizer errors into state and releases the mic', async () => {
    const { engine, mic, getRecognizerOptions } = buildEngine();
    await engine.startManual();
    getRecognizerOptions()?.onError?.('no-speech');
    const state = engine.getState();
    expect(state.phase).toBe('idle');
    expect(state.error).toBe('no-speech');
    expect(mic.release).toHaveBeenCalled();
  });

  it('notifies subscribers on every state change', async () => {
    const { engine } = buildEngine();
    const seen = vi.fn();
    const unsubscribe = engine.subscribe(seen);
    await engine.startManual();
    expect(seen).toHaveBeenCalled();
    expect(seen.mock.calls[seen.mock.calls.length - 1][0].phase).toBe('listening');
    unsubscribe();
    const before = seen.mock.calls.length;
    engine.stop();
    expect(seen.mock.calls.length).toBe(before);
  });

  it('ignores a second start while already listening', async () => {
    const { engine, mic } = buildEngine();
    await engine.startManual();
    await engine.startManual();
    expect(mic.acquire).toHaveBeenCalledOnce();
  });
});
