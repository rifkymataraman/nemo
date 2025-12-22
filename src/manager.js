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
    const { scheduleStart } = await getSchedule(); // Get schedule to define "Day"

    const now = new Date(); // UTC
    const utcHours = now.getUTCHours();
    const currentLocalHour = (utcHours + 7) % 24; // UTC+7
    const startHour = parseInt(scheduleStart.split(':')[0]);

    // Calculate the most recent "Reset Time" (Start of the 'Day')
    // Ideally, currentLocalHour should be around 21:30 (before reset) or similar.
    // If logic is consistent:
    // If now is 21:30 (before 22:00), the 'Day' started Yesterday 22:00.
    // If now is 22:30, the 'Day' started Today 22:00.

    // We want the report to cover the current *cycle*.
    // Assuming report runs at 14:30 UTC = 21:30 UTC+7.
    // Cycle started Yesterday 22:00.

    const cycleStart = new Date(now);
    // Adjustment to align with UTC+7 logic
    // resetDate is the date where the reset happened.
    // If currentLocalHour >= startHour, reset happened today. Else yesterday.

    let daysToSubtract = (currentLocalHour >= startHour) ? 0 : 1;

    // Construct the reset time in UTC
    // We know startHour is UTC+7.
    // UTC Hour = startHour - 7. (Handle negative wrap later)

    // Easier way: Construct in Local Time conceptually, then adjust.
    // Or just use the timestamp math.

    // Let's use the same logic as checkAndRun will use.
    // "Reset Time" = The most recent occurrence of `startHour`

    // UTC hour for reset:
    let resetUtcHour = startHour - 7;
    if (resetUtcHour < 0) resetUtcHour += 24;

    const lastReset = new Date(now);
    lastReset.setUTCHours(resetUtcHour, 0, 0, 0);

    // If now (UTC) < reset (UTC) (Wait, hours might match but minutes?)
    // Simplification:
    // If we calculated ResetUtcHour as 15. Now is 14 (21 Local).
    // Logic: If now.getUTCHours() < resetUtcHour, then reset was yesterday.
    if (now.getUTCHours() < resetUtcHour) {
        lastReset.setUTCDate(lastReset.getUTCDate() - 1);
    }
    // Edge case: if hours are equal, but now minutes < reset minutes? 
    // We assume reset is at minute 0. Report is min 30. So now > reset.
    // But wait, report is 14:30 UTC. Reset is 15:00 UTC.
    // 14 < 15. So reset was yesterday. Correct.

    const cycleDateStr = lastReset.toISOString().split('T')[0];

    const successful = [];
    const failed = [];
    const pending = [];

    for (const account of accounts) {
        let hasRunInCycle = false;
        if (account.lastRun) {
            const lastRunDate = new Date(account.lastRun);
            hasRunInCycle = lastRunDate >= lastReset;
        }

        if (hasRunInCycle && account.status !== 'error') {
            successful.push(account.name);
        } else if (account.status === 'error') {
            // Note: status 'error' might be old. 
            // Ideally we check if it FAILED in this cycle.
            // But status is persistent until next run.
            // If it hasn't run successfully in this cycle, and status is error, list as failed?
            // Or maybe it tried and failed.
            if (hasRunInCycle) {
                // It ran but ended in error
                failed.push(account.name);
            } else {
                // Hasn't run successfully, and status is error (maybe from yesterday?)
                // Let's treat it as Pending/Failed depending on if it TRIED.
                // Simple logic for now:
                failed.push(account.name);
            }
        } else {
            pending.push(account.name);
        }
    }

    const total = accounts.length;
    const successCount = successful.length;

    let message = `**Daily Report (Cycle: ${cycleDateStr})**\n\n`;
    message += `✅ **Completed (${successCount}/${total})**: ${successful.join(', ') || 'None'}\n`;

    if (failed.length > 0) {
        message += `❌ **Errors**: ${failed.join(', ')}\n`;
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

    const { scheduleStart, scheduleEnd, pausedUntil } = await getSchedule();

    // Check Pause State
    if (pausedUntil) {
        const pauseTime = new Date(pausedUntil);
        if (new Date() < pauseTime) {
            console.log(`[Manager] Bot is paused until ${pauseTime.toLocaleString()}. Skipping check.`);
            return;
        }
    }

    const now = new Date();
    // Convert to UTC+7 (Bangkok/Asia timezone)
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const currentHour = (utcHours + 7) % 24; // Add 7 hours for UTC+7

    // scheduleStart/End already destructured above
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

    // Calculate Reset Time based on Schedule Start (e.g., 22:00 UTC+7)
    // startHour is in UTC+7 (e.g. 22)
    let resetUtcHour = startHour - 7;
    if (resetUtcHour < 0) resetUtcHour += 24; // Handle wrap (e.g. 5am - 7 = -2 => 22pm previous day)

    // Determine the most recent reset timestamp
    const lastReset = new Date(now);
    lastReset.setUTCHours(resetUtcHour, 0, 0, 0);

    // If current hour < reset hour, the reset happened yesterday (relative to UTC day)
    if (now.getUTCHours() < resetUtcHour) {
        lastReset.setUTCDate(lastReset.getUTCDate() - 1);
    }

    console.log(`[Manager] Cycle Check: Current Time ${now.toISOString()} | Last Reset (Start of Cycle): ${lastReset.toISOString()}`);

    // Find accounts that haven't run successfully SINCE the last reset
    const pendingAccounts = accounts.filter(a => {
        if (!a.lastRun) return true;
        const lastRunTime = new Date(a.lastRun);

        // 1. Basic Cycle Check: If run AFTER reset, it's done for the cycle.
        if (lastRunTime >= lastReset) return false;

        // 2. Minimum Interval / "Not Before 22:00" Heuristic
        // The user wants to avoid the bot running "early" in the day if it ran late yesterday.
        // We enforce a 20-hour cooldown. This effectively pushes the next run close to the 22:00 reset
        // if the previous run was late.
        const hoursCheck = 20;
        const diffMs = now - lastRunTime;
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffHours < hoursCheck) {
            console.log(`[Manager] Skipping ${a.name}: Last run ${diffHours.toFixed(1)}h ago. Waiting for 20h gap (User Preference).`);
            return false;
        }

        return true;
    });

    if (pendingAccounts.length === 0) {
        console.log('[Manager] All accounts completed or cooling down.');
        return;
    }

    console.log(`[Manager] Found ${pendingAccounts.length} pending accounts. Attempting to run all...`);

    // Run all pending accounts using a Queue System
    const queue = [...pendingAccounts];

    while (queue.length > 0) {
        // Double check if we are still within hours? (Optional, but good practice)
        // Recalculate current hour for accurate check
        const currentUtcHour = (new Date().getUTCHours() + 7) % 24;

        let shouldStop = false;
        if (startHour < endHour) {
            if (currentUtcHour >= endHour) shouldStop = true;
        } else {
            // For cross-midnight, checking "end" is tricky without full date logic.
            // Simplified: if current hour is exactly endHour, stop.
            if (currentUtcHour === endHour) shouldStop = true;
        }

        if (shouldStop) {
            console.log('[Manager] Reached end of active hours. Stopping batch.');
            break;
        }

        const account = queue.shift(); // Take from front

        // 🛠️ FIX: Check Pause Status AGAIN before every account run
        const currentSchedule = await getSchedule();
        if (currentSchedule.pausedUntil && new Date() < new Date(currentSchedule.pausedUntil)) {
            console.log(`[Manager] Pause command detected during batch. Stopping execution.`);
            break; // Stop the loop
        }

        console.log(`[Manager] Queue: Processing ${account.name}... (${queue.length} pending)`);

        const result = await executeSession(account.id, true);

        if (result.success) {
            // Success, already handled in executeSession
            await sendLog(`✅ Session for **${account.name}** completed successfully.`, 'success');
        } else {
            if (result.message === 'BUSY') {
                console.log(`[Manager] Server FULL for ${account.name}. Waiting 5 mins (300s) and retrying immediately...`);
                await sendLog(`⚠️ Server FULL. Waiting 5 mins and retrying **${account.name}**...`, 'warn');

                // Wait 5 minutes (300,000 ms)
                await new Promise(r => setTimeout(r, 300000));

                // Put back at FRONT to retry immediately
                queue.unshift(account);
            }
            else if (result.message && (result.message.includes('Zigza') || result.message.includes('Invalid restore code'))) {
                console.log(`[Manager] Zigza/Error on ${account.name}. Waiting 6 mins and pushing to end of queue.`);
                await sendLog(`⚠️ Zigza/Error on **${account.name}**. Cooling down 6m...`, 'error');

                // Wait 6 minutes (360,000 ms)
                await new Promise(r => setTimeout(r, 360000));

                // Put at BACK to retry later
                queue.push(account);
            }
            else if (result.message && (result.message.includes('Timeout') || result.message.includes('Waiting failed'))) {
                console.log(`[Manager] Timeout/Wait failed for ${account.name}. Waiting 60s and pushing to end of queue.`);
                await sendLog(`⚠️ Timeout on **${account.name}**. Retrying in 60s...`, 'warn');

                // Wait 60 seconds
                await new Promise(r => setTimeout(r, 60000));

                // Put at BACK to retry
                queue.push(account);
            }
            else {
                // Other errors (Driver issue, etc)
                // For now, let's keep it simple: failed.
                console.log(`[Manager] Failed ${account.name} with ${result.message}.`);
                await sendLog(`❌ Failed **${account.name}**: ${result.message}`, 'error');
            }
        }

        // Small delay between successful accounts
        if (result.success) {
            await new Promise(r => setTimeout(r, 5000));
        }
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
