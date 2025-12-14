import { startScheduler } from './src/manager.js';
import { startBot } from './src/bot.js';

console.log('[Main] Starting Evertext Auto Bot...');

// Start the Scheduler
startScheduler();

// Start the Discord Bot
startBot();
