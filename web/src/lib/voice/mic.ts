/**
 * Microphone manager (Stage 5): device enumeration, permission + stream
 * acquisition, and a Web Audio level meter that feeds the VAD. Pure helpers
 * (device filtering, level math) are exported for testing; the browser bits are
 * injected through `MediaDevicesLike` so the whole thing is mockable.
 */

export type MicConstraints = {
  deviceId?: string | null;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
};

export type AudioDeviceInfo = {
  deviceId: string;
  kind: 'audioinput' | 'audiooutput';
  label: string;
};

export type MediaDevicesLike = {
  enumerateDevices: () => Promise<AudioDeviceInfo[]>;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
};

export type MicManager = {
  supported: () => boolean;
  listDevices: () => Promise<{ inputs: AudioDeviceInfo[]; outputs: AudioDeviceInfo[] }>;
  acquire: (constraints?: MicConstraints) => Promise<MediaStream>;
  release: () => void;
  /** Starts metering a stream; returns a stop function. */
  levelMeter: (
    stream: MediaStream,
    onLevel: (level: number) => void,
    intervalMs?: number,
  ) => () => void;
};

export type LevelMeterLike = {
  getByteTimeDomainData: (data: Uint8Array<ArrayBuffer>) => void;
};

export type LevelMeterContext = {
  createMediaStreamSource: (stream: MediaStream) => {
    connect(node: unknown): void;
    disconnect(): void;
  };
  createAnalyser: () => LevelMeterLike;
  close: () => Promise<void>;
};

const DEFAULT_LEVEL_INTERVAL_MS = 60;

/** Filters enumerated media devices into usable input/output lists. */
export function splitDevices(devices: AudioDeviceInfo[]): {
  inputs: AudioDeviceInfo[];
  outputs: AudioDeviceInfo[];
} {
  const inputs = devices.filter((device) => device.kind === 'audioinput');
  const outputs = devices.filter((device) => device.kind === 'audiooutput');
  return { inputs, outputs };
}

/** RMS of a time-domain sample window, normalized to 0..1. */
export function analyzeLevel(samples: Uint8Array<ArrayBuffer>): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const sample of samples) {
    const delta = sample - 128;
    sum += delta * delta;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) / 128);
}

export function isMediaDevicesAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** Creates a level meter from an injectable Web Audio context + analyser. */
export function createLevelMeterLoop(
  context: LevelMeterContext,
  analyser: LevelMeterLike,
  onLevel: (level: number) => void,
  intervalMs = DEFAULT_LEVEL_INTERVAL_MS,
): () => void {
  const data = new Uint8Array(512);
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(data);
    onLevel(analyzeLevel(data));
  }, intervalMs);
  return () => {
    clearInterval(timer);
    try {
      void context.close();
    } catch {
      // Already closed.
    }
  };
}

export function createMicManager(
  devices: MediaDevicesLike | null = typeof navigator !== 'undefined'
    ? (navigator.mediaDevices as unknown as MediaDevicesLike)
    : null,
): MicManager {
  let stream: MediaStream | null = null;

  return {
    supported: () => devices !== null && typeof devices.getUserMedia === 'function',
    async listDevices(): Promise<{ inputs: AudioDeviceInfo[]; outputs: AudioDeviceInfo[] }> {
      if (!devices || typeof devices.enumerateDevices !== 'function') {
        return { inputs: [], outputs: [] };
      }
      const all = await devices.enumerateDevices();
      return splitDevices(all);
    },
    async acquire(constraints: MicConstraints = {}): Promise<MediaStream> {
      if (!devices) {
        throw new Error('Microphone access is not available in this browser.');
      }
      const audio: MediaTrackConstraints = {
        echoCancellation: constraints.echoCancellation ?? true,
        noiseSuppression: constraints.noiseSuppression ?? true,
        autoGainControl: constraints.autoGainControl ?? true,
      };
      if (constraints.deviceId) {
        audio.deviceId = { exact: constraints.deviceId };
      }
      const mediaConstraints: MediaStreamConstraints = { audio };
      stream = await devices.getUserMedia(mediaConstraints);
      return stream;
    },
    release(): void {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    },
    levelMeter(
      activeStream: MediaStream,
      onLevel: (level: number) => void,
      intervalMs = DEFAULT_LEVEL_INTERVAL_MS,
    ): () => void {
      const context = new AudioContext();
      const source = context.createMediaStreamSource(activeStream);
      const analyser = context.createAnalyser();
      source.connect(analyser);
      return createLevelMeterLoop(context, analyser, onLevel, intervalMs);
    },
  };
}
