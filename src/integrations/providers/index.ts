import { registerProvider } from '../registry.js';
import { discordProvider } from './discord/index.js';
import { githubProvider } from './github/index.js';
import { googleProviders } from './google/index.js';
import { notionProvider } from './notion/index.js';
import { slackProvider } from './slack/index.js';
import { whatsappProvider } from './whatsapp/index.js';

for (const provider of googleProviders) {
  registerProvider(provider);
}
registerProvider(githubProvider);
registerProvider(slackProvider);
registerProvider(notionProvider);
registerProvider(discordProvider);
registerProvider(whatsappProvider);
