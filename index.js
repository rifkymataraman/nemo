import { startScheduler } from './src/manager.js';
import { startBot } from './src/bot.js';

console.log('[Main] Starting Evertext Auto Bot...');

// Global Error Handlers
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err);
    // Keep running if possible, or exit with code 1 so the loop restarts it
    // process.exit(1); 
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the Scheduler
startScheduler();

// Start the Discord Bot
startBot();
