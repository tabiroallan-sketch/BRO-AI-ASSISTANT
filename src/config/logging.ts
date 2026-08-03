import pino from 'pino';
import { logBufferStream } from '../lib/log-buffer.js';

const defaultLevel = (process.env.LOG_LEVEL ?? 'info') as pino.LevelWithSilent;

export function createPinoStream(
  level: pino.LevelWithSilent = defaultLevel,
): pino.DestinationStream {
  const streams: pino.StreamEntry<pino.LevelWithSilent>[] = [];

  if (process.env.NODE_ENV === 'development') {
    streams.push({
      level,
      stream: pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }),
    });
  } else {
    streams.push({ level, stream: process.stdout });
  }

  streams.push({ level, stream: logBufferStream });

  return pino.multistream(streams);
}

export function createLogger(): pino.Logger {
  const opts: pino.LoggerOptions = {
    level: defaultLevel,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  return pino(opts, createPinoStream());
}
