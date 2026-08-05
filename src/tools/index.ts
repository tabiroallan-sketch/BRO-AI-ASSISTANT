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
import { contactsSearchTool } from './contacts.js';
import { currentTimeTool } from './current-time.js';
import { discordSendMessageTool } from './discord.js';
import { docsReadTool, docsSearchTool } from './docs.js';
import { driveListFilesTool, driveReadFileTool, driveUploadFileTool } from './drive.js';
import { echoTool } from './echo.js';
import { filesystemTool } from './filesystem.js';
import { gmailReadTool, gmailSearchTool, gmailSendTool } from './gmail.js';
import {
  githubCreateIssueTool,
  githubListCommitsTool,
  githubListIssuesTool,
  githubListPullsTool,
  githubListReleasesTool,
  githubListReposTool,
  githubListWorkflowRunsTool,
  githubProfileTool,
} from './github.js';
import {
  notionCreatePageTool,
  notionSearchDatabasesTool,
  notionSearchPagesTool,
  notionUpdatePageTool,
  notionWorkspaceTool,
} from './notion.js';
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
import {
  slackGetStatusTool,
  slackListChannelsTool,
  slackListUsersTool,
  slackReadMessagesTool,
  slackReadThreadTool,
  slackSendMessageTool,
  slackSetStatusTool,
} from './slack.js';
import { sheetsListTool, sheetsReadTool } from './sheets.js';
import { tasksCreateTool, tasksListTool } from './tasks.js';
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
registerTool(gmailReadTool);
registerTool(gmailSendTool);
registerTool(driveListFilesTool);
registerTool(driveReadFileTool);
registerTool(driveUploadFileTool);
registerTool(docsSearchTool);
registerTool(docsReadTool);
registerTool(sheetsListTool);
registerTool(sheetsReadTool);
registerTool(tasksListTool);
registerTool(tasksCreateTool);
registerTool(contactsSearchTool);
registerTool(githubListReposTool);
registerTool(githubCreateIssueTool);
registerTool(githubListIssuesTool);
registerTool(githubListPullsTool);
registerTool(githubListWorkflowRunsTool);
registerTool(githubListCommitsTool);
registerTool(githubListReleasesTool);
registerTool(githubProfileTool);
registerTool(slackSendMessageTool);
registerTool(slackListChannelsTool);
registerTool(slackReadMessagesTool);
registerTool(slackListUsersTool);
registerTool(slackReadThreadTool);
registerTool(slackGetStatusTool);
registerTool(slackSetStatusTool);
registerTool(discordSendMessageTool);
registerTool(notionWorkspaceTool);
registerTool(notionSearchPagesTool);
registerTool(notionSearchDatabasesTool);
registerTool(notionCreatePageTool);
registerTool(notionUpdatePageTool);
registerTool(n8nListWorkflowsTool);
registerTool(n8nGetWorkflowTool);
registerTool(n8nExecuteWorkflowTool);
registerTool(n8nGetExecutionTool);
registerTool(n8nListExecutionsTool);
registerTool(n8nStopExecutionTool);
registerTool(whatsappSendMessageTool);
