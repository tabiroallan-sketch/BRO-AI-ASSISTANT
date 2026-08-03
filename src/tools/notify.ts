import { prisma } from '../lib/prisma.js';
import type { Tool } from './types.js';

export const notifyTool: Tool = {
  name: 'notify',
  description:
    'Create an in-app notification for the user with a title and optional body. Use this to alert the user about a task, reminder, or result that they should see later.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Short notification title, e.g. "Your report is ready".',
      },
      body: {
        type: 'string',
        description: 'Optional longer description.',
      },
    },
    required: ['title'],
  },
  async execute(args, context) {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!title) {
      throw new Error('Missing "title" argument');
    }
    if (!prisma) {
      throw new Error('Database not configured');
    }
    const body = typeof args.body === 'string' && args.body.trim() ? args.body.trim() : null;
    const notification = await prisma.notification.create({
      data: { userId: context.userId, title, body },
      select: { id: true, title: true, body: true, createdAt: true },
    });
    return `Notification created (id: ${notification.id}): ${notification.title}`;
  },
};
