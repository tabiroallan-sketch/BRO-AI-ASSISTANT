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
import {
  n8nExecuteWorkflowTool,
  n8nGetExecutionTool,
  n8nGetWorkflowTool,
  n8nListExecutionsTool,
  n8nListWorkflowsTool,
  n8nStopExecutionTool,
} from './n8n.js';
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
registerTool(n8nListWorkflowsTool);
registerTool(n8nGetWorkflowTool);
registerTool(n8nExecuteWorkflowTool);
registerTool(n8nGetExecutionTool);
registerTool(n8nListExecutionsTool);
registerTool(n8nStopExecutionTool);
registerTool(whatsappSendMessageTool);
