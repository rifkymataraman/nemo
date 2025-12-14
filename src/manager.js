import cron from 'node-cron';
import { getAccounts, updateAccountStatus, getAccountDecrypted, getSchedule } from './db.js';
import { runSession } from './runner.js';
import { sendLog } from './bot.js';

let isRunning = false;

export const startScheduler = () => {
    console.log('[Manager] Scheduler started. Checking every 10 minutes.');
    // Run every 10 minutes
    cron.schedule('*/10 * * * *', async () => {
        await checkAndRun();
    });

    // Daily Report at 8:00 PM IST (14:30 UTC)
    cron.schedule('30 14 * * *', async () => {
        console.log('[Manager] Generating daily report...');
        await generateDailyReport();
    });
};

const generateDailyReport = async () => {
    const accounts = await getAccounts();
    const today = new Date().toISOString().split('T')[0];

    const successful = [];
    const failed = [];
    const pending = [];

    for (const account of accounts) {
        if (account.lastRun && account.lastRun.startsWith(today) && account.status !== 'error') {
            successful.push(account.name);
        } else if (account.status === 'error') {
            failed.push(account.name);
        } else {
            pending.push(account.name);
        }
    }

    const total = accounts.length;
    const successCount = successful.length;

    let message = `**Daily Report (${today})**\n\n`;
    message += `✅ **Completed (${successCount}/${total})**: ${successful.join(', ') || 'None'}\n`;

    if (failed.length > 0) {
        message += `❌ **Failed**: ${failed.join(', ')}\n`;
    }

    if (pending.length > 0) {
        message += `⚠️ **Not Run**: ${pending.join(', ')}\n`;
    }

    await sendLog(message, 'info');
};

export const checkAndRun = async () => {
    if (isRunning) {
        console.log('[Manager] A session is already running locally. Skipping check.');
        return;
    }

    const now = new Date();
    const currentHour = now.getHours();
    const { scheduleStart, scheduleEnd } = await getSchedule();
    const startHour = parseInt(scheduleStart.split(':')[0]);
    const endHour = parseInt(scheduleEnd.split(':')[0]);

    // Time window check
    let isActiveTime = false;
    if (startHour < endHour) {
        // Standard day schedule (e.g., 10:00 to 20:00)
        isActiveTime = currentHour >= startHour && currentHour < endHour;
    } else {
        // Cross-midnight schedule (e.g., 22:00 to 20:00)
        // Active if it's after start (22, 23...) OR before end (0, 1... 19)
        isActiveTime = currentHour >= startHour || currentHour < endHour;
    }

    if (!isActiveTime) {
        console.log(`[Manager] Outside active hours (${scheduleStart}-${scheduleEnd}). Skipping.`);
        return;
    }

    const accounts = await getAccounts();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Find accounts that haven't run successfully today
    const pendingAccounts = accounts.filter(a => {
        if (!a.lastRun) return true;
        const lastRunDate = new Date(a.lastRun).toISOString().split('T')[0];
        return lastRunDate !== today;
    });

    if (pendingAccounts.length === 0) {
        console.log('[Manager] All accounts have run today.');
        return;
    }

    console.log(`[Manager] Found ${pendingAccounts.length} pending accounts. Attempting to run all...`);

    // Run all pending accounts sequentially
    for (const account of pendingAccounts) {
        // Double check if we are still within hours? (Optional, but good practice)
        if (new Date().getHours() >= endHour) {
            console.log('[Manager] Reached end of active hours. Stopping batch.');
            break;
        }

        console.log(`[Manager] Batch: Attempting to run ${account.name}...`);
        const result = await executeSession(account.id, true); // Pass true to indicate batch mode if needed

        if (!result.success && result.message === 'BUSY') {
            console.log('[Manager] Site is busy. Stopping batch run for now. Will retry remaining later.');
            break; // Stop trying others if site is full
        }

        // Small delay between accounts
        await new Promise(r => setTimeout(r, 5000));
    }
};

export const executeSession = async (accountId) => {
    // Note: We don't check 'isRunning' here strictly if we want to allow the loop in checkAndRun to call this.
    // But we should set isRunning = true during the actual runSession to prevent *other* triggers.
    // Since checkAndRun awaits this, it's fine.

    // Safety check for overlapping manual runs
    if (isRunning) {
        // If called from checkAndRun loop, isRunning might be true? 
        // No, checkAndRun is the one setting the flow.
        // Let's use a lock inside here.
    }

    // Actually, let's just use a simple lock.
    // If we are in the loop, we are the owner of the lock.
    // If a manual run comes in, it should probably wait or fail.

    // For simplicity, let's assume single-threaded Node.js event loop.
    // We just need to ensure we don't start Puppeteer twice.

    // Refactored locking:
    // checkAndRun sets a "batchRunning" flag? No, let's keep it simple.
    // executeSession will handle the lock.

    if (isRunning) {
        return { success: false, message: 'Bot is already running a session.' };
    }

    isRunning = true;
    try {
        const account = await getAccountDecrypted(accountId);
        if (!account) {
            console.error(`[Manager] Account ${accountId} not found.`);
            return { success: false, message: 'Account not found' };
        }

        console.log(`[Manager] Starting session for ${account.name}...`);
        await sendLog(`▶️ Starting session for **${account.name}**...`, 'start');
        await updateAccountStatus(account.id, 'running');

        const result = await runSession(account);

        if (result.success) {
            console.log(`[Manager] Session for ${account.name} completed successfully.`);
            await sendLog(`✅ Session for **${account.name}** completed successfully!`, 'success');
            await updateAccountStatus(account.id, 'idle', new Date().toISOString());
            return { success: true };
        } else {
            console.log(`[Manager] Session for ${account.name} failed: ${result.reason}`);
            await sendLog(`❌ Session for **${account.name}** failed: ${result.reason}`, 'error');
            await updateAccountStatus(account.id, 'error');
            // If BUSY, we return it so the caller knows
            if (result.reason === 'BUSY') {
                return { success: false, message: 'BUSY' };
            }
            if (result.reason.includes('Invalid restore code')) {
                console.log('[Manager] Zigza/Invalid code detected. Marking as error but will retry later.');
            }
            return { success: false, message: result.reason };
        }
    } catch (err) {
        console.error('[Manager] Execution error:', err);
        return { success: false, message: err.message };
    } finally {
        isRunning = false;
    }
};
