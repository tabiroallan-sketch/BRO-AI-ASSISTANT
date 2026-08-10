import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeLevel,
  createLevelMeterLoop,
  createMicManager,
  describeMicError,
  isMediaDevicesAvailable,
  micErrorKind,
  splitDevices,
  type AudioDeviceInfo,
  type LevelMeterLike,
} from '@/lib/voice/mic';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const DEVICES: AudioDeviceInfo[] = [
  { deviceId: 'mic-1', kind: 'audioinput', label: 'Headset Mic' },
  { deviceId: 'mic-2', kind: 'audioinput', label: '' },
  { deviceId: 'spk-1', kind: 'audiooutput', label: 'Speakers' },
];

describe('splitDevices', () => {
  it('splits inputs and outputs', () => {
    const { inputs, outputs } = splitDevices(DEVICES);
    expect(inputs.map((d) => d.deviceId)).toEqual(['mic-1', 'mic-2']);
    expect(outputs.map((d) => d.deviceId)).toEqual(['spk-1']);
  });

  it('handles an empty list', () => {
    expect(splitDevices([])).toEqual({ inputs: [], outputs: [] });
  });
});

describe('analyzeLevel', () => {
  it('returns 0 for an empty window', () => {
    expect(analyzeLevel(new Uint8Array(0))).toBe(0);
  });

  it('returns 0 for silence (midpoint samples)', () => {
    expect(analyzeLevel(new Uint8Array([128, 128, 128]))).toBe(0);
  });

  it('returns 0.5 for half-scale constant samples', () => {
    expect(analyzeLevel(new Uint8Array([192, 192, 192]))).toBeCloseTo(0.5, 5);
  });

  it('clamps at 1 for full-scale samples', () => {
    expect(analyzeLevel(new Uint8Array([255, 255, 255]))).toBeCloseTo(127 / 128, 6);
  });

  it('combines positive and negative deltas via RMS', () => {
    const level = analyzeLevel(new Uint8Array([192, 64, 192, 64]));
    expect(level).toBeCloseTo(0.5, 5);
  });
});

describe('isMediaDevicesAvailable', () => {
  it('is false when there is no navigator/mediaDevices', () => {
    expect(isMediaDevicesAvailable()).toBe(false);
  });

  it('is true when getUserMedia exists', () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } });
    expect(isMediaDevicesAvailable()).toBe(true);
  });
});

describe('micErrorKind / describeMicError', () => {
  function namedError(name: string, message: string): Error {
    const error = new Error(message);
    error.name = name;
    return error;
  }

  it('categorizes a permission denial', () => {
    const error = namedError('NotAllowedError', 'Permission denied');
    expect(micErrorKind(error)).toBe('not-allowed');
    expect(describeMicError(error)).toContain('Microphone permission is blocked');
  });

  it('categorizes a missing microphone', () => {
    const error = namedError('NotFoundError', 'No device');
    expect(micErrorKind(error)).toBe('not-found');
    expect(describeMicError(error)).toContain('No microphone was found');
  });

  it('categorizes an in-use microphone', () => {
    const error = namedError('NotReadableError', 'In use');
    expect(micErrorKind(error)).toBe('not-readable');
    expect(describeMicError(error)).toContain('in use by another app');
  });

  it('passes through unknown errors with their message', () => {
    expect(micErrorKind(new Error('boom'))).toBe('other');
    expect(describeMicError(new Error('boom'))).toBe('boom');
    expect(describeMicError(null)).toBe('Could not access the microphone.');
  });

  it('recognizes a real DOMException permission denial', () => {
    if (typeof DOMException === 'undefined') {
      return;
    }
    const error = new DOMException('Permission denied', 'NotAllowedError');
    expect(micErrorKind(error)).toBe('not-allowed');
  });
});

describe('createLevelMeterLoop', () => {
  function makeAnalyser(level: number): LevelMeterLike {
    return {
      getByteTimeDomainData: (data) => {
        const value = Math.round(128 + level * 128);
        for (let i = 0; i < data.length; i += 1) {
          data[i] = value;
        }
      },
    };
  }

  it('reports the level on each interval and stops cleanly', () => {
    vi.useFakeTimers();
    const onLevel = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const analyser = makeAnalyser(0.5);
    const context = {
      createMediaStreamSource: () => ({ connect: () => undefined, disconnect: () => undefined }),
      createAnalyser: () => analyser,
      close,
    };

    const stop = createLevelMeterLoop(context, analyser, onLevel, 60);
    expect(onLevel).not.toHaveBeenCalled();
    vi.advanceTimersByTime(180);
    expect(onLevel).toHaveBeenCalledTimes(3);
    expect(onLevel).toHaveBeenLastCalledWith(0.5);

    stop();
    vi.advanceTimersByTime(120);
    expect(onLevel).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('createMicManager', () => {
  function streamMock(): MediaStream {
    return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
  }

  it('reports unsupported when no mediaDevices exist', async () => {
    const manager = createMicManager(null);
    expect(manager.supported()).toBe(false);
    await expect(manager.acquire()).rejects.toThrow(/not available/);
    await expect(manager.listDevices()).resolves.toEqual({ inputs: [], outputs: [] });
  });

  it('lists devices split into inputs and outputs', async () => {
    const devices = {
      enumerateDevices: vi.fn().mockResolvedValue(DEVICES),
      getUserMedia: vi.fn(),
    };
    const manager = createMicManager(devices);
    await expect(manager.listDevices()).resolves.toEqual({
      inputs: [DEVICES[0], DEVICES[1]],
      outputs: [DEVICES[2]],
    });
  });

  it('acquires with default processing enabled', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(streamMock());
    const manager = createMicManager({ enumerateDevices: vi.fn(), getUserMedia });
    await manager.acquire();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  });

  it('acquires with an exact device id and processing toggles', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(streamMock());
    const manager = createMicManager({ enumerateDevices: vi.fn(), getUserMedia });
    await manager.acquire({
      deviceId: 'mic-1',
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        deviceId: { exact: 'mic-1' },
      },
    });
  });

  it('release stops the acquired stream tracks', async () => {
    const track = { stop: vi.fn() };
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] });
    const manager = createMicManager({ enumerateDevices: vi.fn(), getUserMedia });
    await manager.acquire();
    manager.release();
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('resumes a suspended audio context so metering sees live audio', () => {
    vi.useFakeTimers();
    const resume = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const analyser = { getByteTimeDomainData: () => undefined };
    const Ctor = vi.fn(() => ({
      state: 'suspended',
      resume,
      close,
      createMediaStreamSource: () => ({ connect: () => undefined, disconnect: () => undefined }),
      createAnalyser: () => analyser,
    }));
    vi.stubGlobal('window', { AudioContext: Ctor });

    const manager = createMicManager(null);
    const stop = manager.levelMeter({} as unknown as MediaStream, vi.fn(), 60);
    expect(Ctor).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    stop();
    vi.advanceTimersByTime(120);
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not resume an already running audio context', () => {
    const resume = vi.fn().mockResolvedValue(undefined);
    const Ctor = vi.fn(() => ({
      state: 'running',
      resume,
      close: vi.fn().mockResolvedValue(undefined),
      createMediaStreamSource: () => ({ connect: () => undefined, disconnect: () => undefined }),
      createAnalyser: () => ({ getByteTimeDomainData: () => undefined }),
    }));
    vi.stubGlobal('window', { AudioContext: Ctor });

    const manager = createMicManager(null);
    const stop = manager.levelMeter({} as unknown as MediaStream, vi.fn(), 60);
    expect(resume).not.toHaveBeenCalled();
    stop();
  });
});
