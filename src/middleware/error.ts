import type { FastifyError } from 'fastify';

export function formatError(error: FastifyError): {
  statusCode?: number;
  message: string;
  code?: string;
} {
  return {
    statusCode: error.statusCode,
    message: error.message,
    code: error.code,
  };
}
