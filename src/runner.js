import puppeteer from 'puppeteer';

const GAME_URL = 'https://evertext.sytes.net';
const BLOCKED_DOMAINS = ['google.com', 'googleapis.com', 'gstatic.com'];
const BLOCKED_RESOURCES = ['image', 'font', 'media'];

export const runSession = async (account) => {
    let browser;
    try {
        console.log('\n' + '='.repeat(60));
        console.log(`🤖 [Runner] Starting session for "${account.name}"`);
        console.log('='.repeat(60));

        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                // Essential security flags
                '--no-sandbox',
                '--disable-setuid-sandbox',

                // Aggressive memory reduction
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-accelerated-2d-canvas',
                '--disable-accelerated-video-decode',
                '--disable-3d-apis',

                // Limit processes and memory
                '--single-process', // Run in single process (saves ~100-150MB)
                '--no-zygote',
                '--disable-renderer-backgrounding',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-ipc-flooding-protection',

                // Reduce cache and history
                '--disk-cache-size=1',
                '--media-cache-size=1',
                '--aggressive-cache-discard',
                '--disable-cache',
                '--disable-application-cache',
                '--disable-offline-load-stale-cache',

                // Disable unnecessary features
                '--disable-extensions',
                '--disable-component-extensions-with-background-pages',
                '--disable-default-apps',
                '--disable-sync',
                '--disable-translate',
                '--disable-notifications',
                '--disable-speech-api',
                '--disable-webgl',
                '--disable-web-security', // Only for localhost/testing

                // Reduce JavaScript heap size (critical for memory limit)
                '--js-flags=--max-old-space-size=256', // Limit V8 heap to 256MB

                // Window size
                '--window-size=800,600',
                '--no-first-run'
            ]
        });
        const page = await browser.newPage();

        // Optimize memory and block unnecessary resources
        await page.setViewport({ width: 800, height: 600 });
        await page.setRequestInterception(true);

        // Block even more resources to save memory
        const BLOCKED_RESOURCES_EXTENDED = ['image', 'font', 'media', 'stylesheet', 'texttrack', 'eventsource', 'manifest'];

        page.on('request', (req) => {
            const url = req.url();
            if (BLOCKED_DOMAINS.some(domain => url.includes(domain)) ||
                BLOCKED_RESOURCES_EXTENDED.includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Disable JavaScript console to save memory
        page.on('console', () => { }); // Ignore console messages

        // Clear page cache periodically during execution
        const clearMemory = async () => {
            try {
                await page.evaluate(() => {
                    // Clear any accumulated data
                    if (window.gc) window.gc(); // Force garbage collection if available
                });
            } catch (e) { /* ignore */ }
        };

        await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });

        // Check server capacity with retry
        let activeUsers = 0, maxUsers = 0, retries = 0;
        while (retries < 10) {
            try {
                [activeUsers, maxUsers] = await page.evaluate(() => {
                    const active = parseInt(document.getElementById('active_users')?.textContent || '0');
                    const max = parseInt(document.getElementById('max_users')?.textContent || '0');
                    return [active, max];
                });

                console.log(`📊 Server Status Check ${retries + 1}: ${activeUsers}/${maxUsers} slots used`);
                if (maxUsers > 0) break;
            } catch (e) {
                console.log(`⚠️ Error reading user counts (Attempt ${retries + 1}): ${e.message}`);
            }
            await new Promise(r => setTimeout(r, 1000));
            retries++;
        }

        if (maxUsers === 0) {
            console.log('⚠️ Could not retrieve valid server capacity data. Proceeding anyway.');
        } else if (activeUsers >= maxUsers) {
            console.log('❌ System full. Aborting session.');
            await browser.close();
            return { success: false, reason: 'BUSY' };
        }

        // Start terminal session
        console.log('▶️  Starting terminal session...');
        await page.click('#startBtn');
        await page.waitForSelector('#connection_status', { timeout: 10000 });

        // Optimized command sender - no redundant focus/clear operations
        const send = async (cmd, delay = 500) => {
            await page.waitForSelector('#commandInput', { visible: true });
            await page.evaluate((command) => {
                const input = document.getElementById('commandInput');
                input.value = command;
            }, cmd);
            await page.click('#sendBtn');
            await new Promise(r => setTimeout(r, delay));
        };

        // Optimized output waiter
        const waitFor = async (text, timeout = 30000) => {
            try {
                await page.waitForFunction(
                    (t) => document.getElementById('output')?.innerText.includes(t),
                    { timeout },
                    text
                );
                return true;
            } catch { return false; }
        };

        // Optimized error checker
        const getOutput = () => page.evaluate(() => document.getElementById('output')?.innerText || '');

        // Step 1: Send initial command
        console.log('\n📝 Step 1: Waiting for command prompt...');
        if (!await waitFor('Enter Command to use :')) {
            throw new Error('Timeout waiting for command prompt');
        }
        console.log('✅ Command prompt received\n📤 Sending command: d');
        await send('d', 1000);

        const output1 = await getOutput();
        if (output1.includes('Either Zigza error or Incorrect Restore Code') ||
            output1.includes('error') || output1.includes('Error')) {
            throw new Error('Error after sending \'d\'');
        }

        // Step 2: Send restore code
        console.log('\n🔑 Step 2: Waiting for restore code prompt...');
        if (!await waitFor('Enter Restore code of Your Account')) {
            throw new Error('Timeout waiting for restore code prompt');
        }
        console.log(`✅ Restore code prompt received\n📤 Sending restore code: ${account.code.substring(0, 4)}****`);
        await send(account.code, 3000);

        const output2 = await getOutput();
        if (output2.includes('Either Zigza error or Incorrect Restore Code')) {
            console.log('❌ Authentication failed: Invalid restore code');
            throw new Error('Invalid restore code or authentication failed');
        }
        console.log('✅ Authentication successful!');

        // Step 3: Server selection
        console.log('\n🎮 Step 3: Waiting for server selection...');
        if (!await waitFor('Which acc u want to Login', 60000)) {
            throw new Error('Timeout waiting for server selection prompt');
        }
        console.log('✅ Server list received');

        const serverIndex = await page.evaluate((target) => {
            const text = document.getElementById('output')?.innerText || '';
            const regex = /(\d+)--\>.*?\((E-\d+|All of them)\)/g;
            const map = {};
            let match;
            while ((match = regex.exec(text)) !== null) {
                map[match[2]] = match[1];
            }
            return target.toLowerCase() === 'all' ? map['All of them'] : map[target];
        }, account.targetServer);

        if (!serverIndex) {
            throw new Error(`Target server "${account.targetServer}" not found in list`);
        }

        console.log(`✅ Found target server: ${account.targetServer}\n📤 Selecting server (option ${serverIndex})...`);
        await send(serverIndex);

        // Step 4: Handle events
        console.log('\n🎉 Step 4: Handling Events...');
        console.log('⏳ Waiting 3 minutes for events processing...');

        // Unconditional 3-minute wait as requested
        await new Promise(r => setTimeout(r, 180000));

        console.log('✅ 3 minutes passed. Executing rapid-fire sequence...');
        const commands = ['y', 'next', 'auto', 'no', 'no', 'no', 'no'];
        for (const cmd of commands) {
            await send(cmd, 200); // Reduced delay for rapid fire
        }

        // Step 5: Cleanup loop
        console.log('\n🔄 Step 5: Monitoring for completion...');
        const startTime = Date.now();
        let processEnded = false;

        while (!processEnded && (Date.now() - startTime < 900000)) {
            const output = await getOutput();

            if (output.includes('Process ended with return code 0')) {
                processEnded = true;
                console.log('✅ Process ended successfully (Return Code 0)');
                break;
            }

            if ((output.includes('Press y to do more events') ||
                output.includes('Press y to perform more commands') ||
                output.includes('Invalid Stage Entered')) &&
                (output.trim().endsWith(':') || output.trim().endsWith('>'))) {
                console.log('👉 Prompt detected. Sending "no" twice...');
                await send('no', 500);
                await send('no', 1000); // Reduced from 5000 to 1000
                continue;
            }

            await new Promise(r => setTimeout(r, 1000)); // Reduced polling from 2000 to 1000
        }

        if (!processEnded) {
            console.log('⚠️ Session timed out waiting for process end code');
        }

        console.log('\n✅ Session completed!\n🔌 Connection closed');
        await browser.close();
        console.log('='.repeat(60) + '\n');
        return { success: true };

    } catch (error) {
        console.log('\n❌ ERROR OCCURRED\n💥 Error details:', error.message);
        console.log('='.repeat(60) + '\n');
        if (browser) await browser.close();
        return { success: false, reason: error.message };
    }
};
