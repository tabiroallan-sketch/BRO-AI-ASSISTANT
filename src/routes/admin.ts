import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  HttpError,
  invalidateCachedUser,
  requireAuth,
  requireRole,
  type Role,
} from '../lib/auth.js';
import { getAuditLogs, readAuditLogs, recordAudit } from '../lib/audit.js';
import { isEncryptionEnabled } from '../lib/encryption.js';
import { prisma } from '../lib/prisma.js';
import { listSecretStatuses } from '../lib/secrets.js';
import { listProviders } from '../integrations/providers.js';
import { getIntegration } from '../integrations/store.js';
import { updatePermissionSet } from '../integrations/trust-store.js';

function encryptionStatus(): boolean {
  try {
    return isEncryptionEnabled();
  } catch {
    return false;
  }
}

const updateUserSchema = z
  .object({
    role: z.enum(['USER', 'ADMIN']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => value.role !== undefined || value.isActive !== undefined, {
    message: 'Provide role and/or isActive',
  });

const grantPermissionsSchema = z.object({
  email: z.string().email().optional(),
});

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('ADMIN'));

  app.get('/admin/users', async () => {
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { count: users.length, users };
  });

  app.patch('/admin/users/:id', async (request, reply) => {
    const params = request.params as { id?: string };
    if (!params.id) {
      throw new HttpError(400, 'Missing user id');
    }
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }

    if (request.user?.id === params.id) {
      if (parsed.data.isActive === false) {
        throw new HttpError(400, 'You cannot deactivate your own account');
      }
      if (parsed.data.role === 'USER') {
        throw new HttpError(400, 'You cannot demote your own account');
      }
    }

    const existing = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!existing) {
      throw new HttpError(404, 'User not found');
    }

    const updated = await prisma.user.update({
      where: { id: params.id },
      data: parsed.data as { role?: Role; isActive?: boolean },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
      },
    });

    invalidateCachedUser(updated.id);

    recordAudit({
      actorId: request.user?.id,
      actorEmail: request.user?.email,
      action: 'admin.user.update',
      target: params.id,
      detail: JSON.stringify(parsed.data),
      ip: request.ip,
    });

    return reply.send({ user: updated });
  });

  app.get('/admin/secrets', async (request) => {
    const secrets = listSecretStatuses();
    recordAudit({
      actorId: request.user?.id,
      actorEmail: request.user?.email,
      action: 'admin.secrets.read',
      ip: request.ip,
    });
    return {
      count: secrets.length,
      configuredCount: secrets.filter((secret) => secret.configured).length,
      encryptionEnabled: encryptionStatus(),
      secrets,
    };
  });

  app.get('/admin/audit', async (request) => {
    const query = request.query as { limit?: string };
    const parsed = Number.parseInt(query.limit ?? '200', 10);
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 1000) : 200;
    const events =
      prisma && typeof prisma.auditLog?.findMany === 'function'
        ? await readAuditLogs(limit)
        : getAuditLogs(limit);
    return { count: events.length, events };
  });

  /**
   * Enables every Permission Center permission for every provider the target
   * user has connected, so an admin can grant full capability access in one
   * step. Providers without a connection are skipped (a permission set is tied
   * to an integration record), and unknown permission ids are never stored.
   */
  app.post('/admin/permissions/grant-all', async (request, reply) => {
    const parsed = grantPermissionsSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const email = (parsed.data.email ?? request.user?.email)?.toLowerCase().trim();
    if (!email) {
      throw new HttpError(400, 'An email is required');
    }
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
    if (!user) {
      throw new HttpError(404, 'User not found');
    }

    const providersUpdated: string[] = [];
    let permissionsGranted = 0;
    for (const provider of listProviders()) {
      const record = await getIntegration(user.id, provider.id);
      if (!record) {
        continue;
      }
      const allPermissionIds = provider.permissions
        .map((permission) => permission.id)
        .filter(Boolean);
      if (allPermissionIds.length === 0) {
        continue;
      }
      await updatePermissionSet(record.id, allPermissionIds);
      providersUpdated.push(provider.id);
      permissionsGranted += allPermissionIds.length;
    }

    recordAudit({
      actorId: request.user?.id,
      actorEmail: request.user?.email,
      action: 'admin.permissions.grant_all',
      target: user.id,
      detail: JSON.stringify({
        email: user.email,
        providers: providersUpdated,
        permissionsGranted,
      }),
      ip: request.ip,
    });

    return reply.send({
      ok: true,
      user: { id: user.id, email: user.email },
      providersUpdated,
      permissionsGranted,
    });
  });
}
