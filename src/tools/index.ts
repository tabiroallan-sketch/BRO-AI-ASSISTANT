import {
  browserClickTool,
  browserCloseTool,
  browserDownloadTool,
  browserExtractTool,
  browserFillTool,
  browserNavigateTool,
  browserOpenTool,
  browserReadTool,
  browserScreenshotTool,
} from './browser.js';
import { calculateTool } from './calculate.js';
import { calendarCreateEventTool, calendarListEventsTool } from './calendar.js';
import { clipboardTool } from './clipboard.js';
import { currentTimeTool } from './current-time.js';
import { discordSendMessageTool } from './discord.js';
import { driveListFilesTool } from './drive.js';
import { echoTool } from './echo.js';
import { filesystemTool } from './filesystem.js';
import { gmailSearchTool, gmailSendTool } from './gmail.js';
import { githubCreateIssueTool, githubListReposTool } from './github.js';
import { notionCreatePageTool, notionSearchPagesTool } from './notion.js';
import { notifyTool } from './notify.js';
import { pdfReaderTool } from './pdf-reader.js';
import { registerTool } from './registry.js';
import { slackSendMessageTool } from './slack.js';
import { weatherTool } from './weather.js';
import { webSearchTool } from './web-search.js';
import { whatsappSendMessageTool } from './whatsapp.js';

registerTool(browserOpenTool);
registerTool(browserNavigateTool);
registerTool(browserReadTool);
registerTool(browserClickTool);
registerTool(browserFillTool);
registerTool(browserScreenshotTool);
registerTool(browserExtractTool);
registerTool(browserDownloadTool);
registerTool(browserCloseTool);
registerTool(currentTimeTool);
registerTool(calculateTool);
registerTool(echoTool);
registerTool(webSearchTool);
registerTool(weatherTool);
registerTool(filesystemTool);
registerTool(pdfReaderTool);
registerTool(clipboardTool);
registerTool(notifyTool);
registerTool(calendarListEventsTool);
registerTool(calendarCreateEventTool);
registerTool(gmailSearchTool);
registerTool(gmailSendTool);
registerTool(driveListFilesTool);
registerTool(githubListReposTool);
registerTool(githubCreateIssueTool);
registerTool(slackSendMessageTool);
registerTool(discordSendMessageTool);
registerTool(notionSearchPagesTool);
registerTool(notionCreatePageTool);
registerTool(whatsappSendMessageTool);
