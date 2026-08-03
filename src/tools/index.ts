import { calculateTool } from './calculate.js';
import { currentTimeTool } from './current-time.js';
import { echoTool } from './echo.js';
import { registerTool } from './registry.js';

registerTool(currentTimeTool);
registerTool(calculateTool);
registerTool(echoTool);
