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
import {
  calendarCreateEventTool,
  calendarDeleteEventTool,
  calendarListCalendarsTool,
  calendarListEventsTool,
  calendarUpdateEventTool,
} from './calendar.js';
import { clipboardTool } from './clipboard.js';
import { contactsSearchTool } from './contacts.js';
import { currentTimeTool } from './current-time.js';
import { discordSendMessageTool } from './discord.js';
import {
  docsAppendTool,
  docsCreateTool,
  docsInsertTextTool,
  docsReadTool,
  docsReplaceTool,
  docsSearchTool,
} from './docs.js';
import {
  driveCopyFileTool,
  driveCreateFolderTool,
  driveDeleteFileTool,
  driveGetMetadataTool,
  driveListFilesTool,
  driveMoveFileTool,
  driveReadFileTool,
  driveUploadFileTool,
} from './drive.js';
import { echoTool } from './echo.js';
import { filesystemTool } from './filesystem.js';
import {
  gmailForwardTool,
  gmailListLabelsTool,
  gmailModifyTool,
  gmailReadThreadTool,
  gmailReadTool,
  gmailReplyTool,
  gmailSearchTool,
  gmailSendTool,
} from './gmail.js';
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
  salesAnalyzeMarginTool,
  salesAnalyzeProspectTool,
  salesBuildPersonaTool,
  salesDesignOfferTool,
  salesDiscoverOpportunitiesTool,
  salesEstimatePriceTool,
  salesGeneratePitchTool,
  salesNegotiationStrategyTool,
  salesNextBestActionTool,
  salesPipelineSummaryTool,
  salesPrepareObjectionsTool,
  salesResearchCompanyTool,
  salesScoreOpportunityTool,
} from '../sales/tools.js';
import { systemRunCommandTool, systemRunScriptTool } from './system/command-tools.js';
import {
  systemCreateFolderTool,
  systemDeleteTool,
  systemRenameTool,
  systemSearchFilesTool,
} from './system/file-tools.js';
import { systemReadClipboardTool, systemWriteClipboardTool } from './system/clipboard-tools.js';
import {
  systemOpenBrowserTool,
  systemOpenEditorTool,
  systemOpenTerminalTool,
} from './system/launcher-tools.js';
import {
  systemLaunchAppTool,
  systemListProcessesTool,
  systemTerminateAppTool,
} from './system/process-tools.js';
import {
  systemFocusWindowTool,
  systemListWindowsTool,
  systemMinimizeWindowTool,
} from './system/window-tools.js';
import {
  slackGetStatusTool,
  slackListChannelsTool,
  slackListUsersTool,
  slackReadMessagesTool,
  slackReadThreadTool,
  slackSendMessageTool,
  slackSetStatusTool,
} from './slack.js';
import {
  sheetsAppendTool,
  sheetsClearTool,
  sheetsCreateTool,
  sheetsListTool,
  sheetsReadTool,
  sheetsWriteTool,
} from './sheets.js';
import {
  slidesAddSlideTool,
  slidesCreateTool,
  slidesListTool,
  slidesReadTool,
  slidesUpdateTextTool,
} from './slides.js';
import {
  tasksCompleteTool,
  tasksCreateTool,
  tasksDeleteTool,
  tasksListTool,
  tasksUpdateTool,
} from './tasks.js';
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
registerTool(systemLaunchAppTool);
registerTool(systemTerminateAppTool);
registerTool(systemListProcessesTool);
registerTool(systemRunCommandTool);
registerTool(systemRunScriptTool);
registerTool(systemSearchFilesTool);
registerTool(systemRenameTool);
registerTool(systemDeleteTool);
registerTool(systemCreateFolderTool);
registerTool(systemOpenBrowserTool);
registerTool(systemOpenEditorTool);
registerTool(systemOpenTerminalTool);
registerTool(systemReadClipboardTool);
registerTool(systemWriteClipboardTool);
registerTool(systemListWindowsTool);
registerTool(systemFocusWindowTool);
registerTool(systemMinimizeWindowTool);
registerTool(calendarListEventsTool);
registerTool(calendarCreateEventTool);
registerTool(calendarUpdateEventTool);
registerTool(calendarDeleteEventTool);
registerTool(calendarListCalendarsTool);
registerTool(gmailSearchTool);
registerTool(gmailReadTool);
registerTool(gmailSendTool);
registerTool(gmailReplyTool);
registerTool(gmailForwardTool);
registerTool(gmailListLabelsTool);
registerTool(gmailReadThreadTool);
registerTool(gmailModifyTool);
registerTool(driveListFilesTool);
registerTool(driveReadFileTool);
registerTool(driveUploadFileTool);
registerTool(driveCreateFolderTool);
registerTool(driveDeleteFileTool);
registerTool(driveMoveFileTool);
registerTool(driveCopyFileTool);
registerTool(driveGetMetadataTool);
registerTool(docsSearchTool);
registerTool(docsReadTool);
registerTool(docsCreateTool);
registerTool(docsAppendTool);
registerTool(docsReplaceTool);
registerTool(docsInsertTextTool);
registerTool(sheetsListTool);
registerTool(sheetsReadTool);
registerTool(sheetsWriteTool);
registerTool(sheetsAppendTool);
registerTool(sheetsCreateTool);
registerTool(sheetsClearTool);
registerTool(slidesListTool);
registerTool(slidesReadTool);
registerTool(slidesCreateTool);
registerTool(slidesAddSlideTool);
registerTool(slidesUpdateTextTool);
registerTool(tasksListTool);
registerTool(tasksCreateTool);
registerTool(tasksUpdateTool);
registerTool(tasksCompleteTool);
registerTool(tasksDeleteTool);
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
registerTool(salesResearchCompanyTool);
registerTool(salesAnalyzeProspectTool);
registerTool(salesScoreOpportunityTool);
registerTool(salesGeneratePitchTool);
registerTool(salesNextBestActionTool);
registerTool(salesPipelineSummaryTool);
registerTool(salesEstimatePriceTool);
registerTool(salesDiscoverOpportunitiesTool);
registerTool(salesBuildPersonaTool);
registerTool(salesDesignOfferTool);
registerTool(salesPrepareObjectionsTool);
registerTool(salesNegotiationStrategyTool);
registerTool(salesAnalyzeMarginTool);
