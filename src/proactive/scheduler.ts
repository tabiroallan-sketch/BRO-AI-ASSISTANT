import type { Runner } from '../system/types.js';
import type { HttpProbe, PortProbe, SystemProbe, SystemSample } from './probes.js';
import type { DedupeStore } from './dedupe.js';
import { normalizeSettings } from './settings.js';
import { isSuppressedDuringQuietHours } from './quiet-hours.js';
import {
  checkCalendarMonitors,
  checkEmailMonitors,
  checkEndpointMonitors,
  checkGithubMonitors,
  checkLocalMonitors,
  kindToDedupeMode,
  type JsonFetcher,
} from './monitors.js';
import type {
  NotificationKind,
  NotificationPriority,
  ProactiveDraft,
  ProactiveSettings,
  ProactiveSweepResult,
} from './types.js';

export interface SchedulerDependencies {
  listUsers: () => Promise<Array<{ id: string; settings: unknown }>>;
  getToken: (userId: string, providerId: string) => Promise<string | null>;
  createNotification: (data: {
    userId: string;
    title: string;
    body: string | null;
    kind: NotificationKind;
    priority: NotificationPriority;
    metadata: Record<string, unknown> | null;
  }) => Promise<void>;
  dedupe: DedupeStore;
  systemProbe: SystemProbe;
  commandRunner: Runner;
  portProbe: PortProbe;
  httpProbe: HttpProbe;
  fetch: JsonFetcher;
  now: () => Date;
}

/** Longest cooldown seen in practice; entries older than this are pruned. */
const DEDUPE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export interface Scheduler {
  runSweep(): Promise<ProactiveSweepResult>;
}

export function createScheduler(deps: SchedulerDependencies): Scheduler {
  async function collectDrafts(
    userId: string,
    settings: ProactiveSettings,
    systemProbePromise: Promise<SystemSample>,
    reportError: (source: string, error: unknown) => void,
  ): Promise<ProactiveDraft[]> {
    const drafts: ProactiveDraft[] = [];
    if (settings.sources.lowDisk || settings.sources.highCpu) {
      try {
        drafts.push(...checkLocalMonitors(await systemProbePromise, settings));
      } catch (error) {
        reportError('local', error);
      }
    }
    try {
      drafts.push(...(await checkEndpointMonitors(settings, deps)));
    } catch (error) {
      reportError('endpoints', error);
    }
    if (settings.sources.email) {
      try {
        const token = await deps.getToken(userId, 'google-gmail');
        if (token) {
          drafts.push(...(await checkEmailMonitors(token, settings, deps.fetch)));
        }
      } catch (error) {
        reportError('email', error);
      }
    }
    if (settings.sources.calendar) {
      try {
        const token = await deps.getToken(userId, 'google-calendar');
        if (token) {
          drafts.push(...(await checkCalendarMonitors(token, settings, deps.fetch, deps.now())));
        }
      } catch (error) {
        reportError('calendar', error);
      }
    }
    if (settings.sources.github) {
      try {
        const token = await deps.getToken(userId, 'github');
        if (token) {
          drafts.push(...(await checkGithubMonitors(token, settings, deps.fetch, deps.now())));
        }
      } catch (error) {
        reportError('github', error);
      }
    }
    return drafts;
  }

  return {
    async runSweep(): Promise<ProactiveSweepResult> {
      const now = deps.now();
      const result: ProactiveSweepResult = {
        checkedAt: now,
        users: 0,
        notificationsCreated: 0,
        suppressed: 0,
        skipped: 0,
        errors: [],
      };
      const users = await deps.listUsers();
      result.users = users.length;

      const systemProbePromise = deps.systemProbe();

      for (const user of users) {
        const settings = normalizeSettings(user.settings);
        if (!settings.enabled) {
          result.skipped += 1;
          continue;
        }
        const reportError = (source: string, error: unknown): void => {
          result.errors.push({ userId: user.id, source, message: errorMessage(error) });
        };
        try {
          const drafts = await collectDrafts(user.id, settings, systemProbePromise, reportError);
          for (const draft of drafts) {
            const mode = kindToDedupeMode(draft.kind);
            if (mode === 'once') {
              if (deps.dedupe.rememberOnce(user.id, draft.dedupeKey, now)) {
                continue;
              }
            } else if (
              deps.dedupe.inCooldown(
                user.id,
                draft.dedupeKey,
                settings.cooldownMinutes * 60_000,
                now,
              )
            ) {
              continue;
            }
            if (isSuppressedDuringQuietHours(draft.priority, settings.quietHours, now)) {
              result.suppressed += 1;
              continue;
            }
            await deps.createNotification({
              userId: user.id,
              title: draft.title,
              body: draft.body,
              kind: draft.kind,
              priority: draft.priority,
              metadata: { ...draft.metadata, dedupeKey: draft.dedupeKey },
            });
            result.notificationsCreated += 1;
          }
        } catch (error) {
          reportError('sweep', error);
        }
      }
      deps.dedupe.prune(DEDUPE_MAX_AGE_MS, now);
      return result;
    },
  };
}
