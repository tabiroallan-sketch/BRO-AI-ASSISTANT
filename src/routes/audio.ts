import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, requireAuth } from '../lib/auth.js';
import { aiConfigured, transcribeAudioChunk, type TranscribeAudioFormat } from '../lib/ai.js';

const transcribeSchema = z.object({
  audio: z.string().min(1).max(14_000_000),
  format: z.enum(['wav', 'mp3', 'aiff', 'aac', 'ogg', 'flac']).default('wav'),
});

function transcribeErrorMessage(error: unknown): string {
  const status = (error as { status?: unknown }).status;
  if (status === 429) {
    return 'The AI provider is rate-limiting requests. Please wait a moment and try again.';
  }
  if (status === 401 || status === 403) {
    return 'The AI provider rejected the API key. Check the provider key and quota.';
  }
  if (status === 404) {
    return 'The AI provider could not process this audio. Check the model and API key.';
  }
  const message = error instanceof Error ? error.message : '';
  if (message.includes('no text')) {
    return 'No speech was detected in the audio.';
  }
  return 'Transcription failed';
}

export async function audioRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.post('/audio/transcribe', { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    if (!aiConfigured()) {
      throw new HttpError(503, 'AI is not configured');
    }
    const parsed = transcribeSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const { audio, format } = parsed.data;
    try {
      const text = await transcribeAudioChunk(audio, format as TranscribeAudioFormat);
      return reply.send({ text });
    } catch (error) {
      app.log.error({ err: error }, 'audio transcription failed');
      throw new HttpError(502, transcribeErrorMessage(error));
    }
  });
}
