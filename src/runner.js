import puppeteer from 'puppeteer';
import fs from 'fs';

const GAME_URL = 'https://evertext.sytes.net/';
const BLOCKED_DOMAINS = ['google-analytics.com', 'googletagmanager.com', 'facebook.net'];

export const runSession = async (account) => {
    let browser;
    try {
        // Determine executable path based on OS
        const isWindows = process.platform === 'win32';
        const config = {
            headless: isWindows ? false : true, // Headless on Linux/Server, Visible on Windows
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-accelerated-2d-canvas',
                '--disable-accelerated-video-decode',
                '--disable-3d-apis',
                '--disable-renderer-backgrounding',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-ipc-flooding-protection',
                '--disk-cache-size=1',
                '--media-cache-size=1',
                '--aggressive-cache-discard',
                '--disable-cache',
                '--disable-application-cache',
                '--disable-offline-load-stale-cache',
                '--disable-extensions',
                '--disable-component-extensions-with-background-pages',
                '--disable-default-apps',
                '--disable-sync',
                '--disable-translate',
                '--disable-notifications',
                '--disable-speech-api',
                '--disable-webgl',
                '--window-size=800,600',
                '--no-first-run'
            ]
        };

        if (isWindows) {
            config.executablePath = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
        } else {
            // On Linux/Zeabur, let Puppeteer use its bundled Chromium or system installed one
            // If needed, we can specificy typical linux paths, but default usually works best if deps are installed
            console.log('[Runner] Running on Linux/Server. Using default Puppeteer executable.');
        }

        browser = await puppeteer.launch(config);


        const page = await browser.newPage();

        // 🛠️ FIX: Set User Agent to mimic regular Chrome (Bypass Headless detection)
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

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

        // Load cookies if available
        try {
            if (fs.existsSync('./data/cookies.json')) {
                const cookiesString = fs.readFileSync('./data/cookies.json');
                const cookies = JSON.parse(cookiesString);
                await page.setCookie(...cookies);
                console.log('🍪 Loaded session cookies.');
            } else {
                console.log('⚠️ No cookies found. Bot may get stuck at login.');
            }
        } catch (error) {
            console.log('⚠️ Failed to load cookies:', error.message);
        }

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

        // Check server status
        const checkServerStatus = async (page) => {
            console.log('🚧 DEV MODE: Bypassing server capacity check...');
            return true;
            /*
                        try {
                            const statusText = await page.evaluate(() => {
                                const el = document.querySelector('span[style*="color:red"]');
                                return el ? el.innerText : null;
                            });
                    
                            if (statusText) {
                                console.log(`📊 Server Status Check 1: ${statusText}`);
                                if (statusText.includes('full')) return false;
                            }
                    
                            const slotsText = await page.evaluate(() => {
                                 // Example selector, might vary. 
                                 // Logic in runner was checking specific text
                                 return document.body.innerText;
                            });
                            
                            // Simple check for "4/4" or similar indicating full
                            // This is a naive check based on previous logs "4/4 slots used"
                            if (slotsText.includes('4/4 slots used') || slotsText.includes('System full')) {
                                 console.log('📊 Server Status Check 2: System seems full.');
                                 return false;
                            }
                            
                            return true;
                        } catch (e) {
                            console.log('Server check error', e);
                            return true; // Assume up if check fails
                        }
                        */
        };    // Optimized command sender - no redundant focus/clear operations
        const send = async (cmd, delay = 500) => {
            await page.waitForSelector('#commandInput', { visible: true });
            await page.type('#commandInput', cmd, { delay: 50 }); // Simulate typing
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
        if (!await waitFor('Enter Command to use :', 60000)) {
            // DEBUG: Log what IS on the screen if we time out
            const bodyText = await page.evaluate(() => document.body.innerText);
            console.log('⚠️ Timeout Debug - Screen Content Preview:\n', bodyText.substring(0, 500) + '...');
            throw new Error('Timeout waiting for command prompt');
        }
        console.log('✅ Command prompt received');
        console.log('📤 Sending command: d');
        await send('d', 1000);

        // Step 2: Send restore code
        console.log('\n🔑 Step 2: Waiting for restore code prompt...');
        if (!await waitFor('Enter Restore code of Your Account')) {
            throw new Error('Timeout waiting for restore code prompt');
        }
        console.log(`✅ Restore code prompt received\n📤 Sending restore code: ${account.code.substring(0, 4)}****`);
        await send(account.code, 3000);

        // Check for Zigza/Error explicitly with a short wait before proceeding to full poll
        try {
            await page.waitForFunction(
                () => {
                    const text = document.getElementById('output')?.innerText || '';
                    return text.includes('Either Zigza error') || text.includes('Incorrect Restore Code');
                },
                { timeout: 5000 }
            );
            throw new Error('Zigza Error or Incorrect Code Detected immediately');
        } catch (e) {
            if (e.message.includes('Zigza')) throw e;
            // If timeout, it means no immediate error, continue to wait for success/selection
        }

        // Poll for login success or server selection
        console.log('⏳ Waiting for login response...');
        let loginState = 'waiting';
        let outputAfterLogin = '';

        for (let i = 0; i < 60; i++) {
            outputAfterLogin = await getOutput();

            if (outputAfterLogin.includes('Which acc u want to Login')) {
                loginState = 'selection';
                break;
            }
            if (outputAfterLogin.includes('Login / Relog Successfull')) {
                loginState = 'success';
                break;
            }
            if (outputAfterLogin.includes('Either Zigza error') || outputAfterLogin.includes('Incorrect Restore Code')) {
                loginState = 'error';
                break;
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        if (loginState === 'error') {
            console.log('❌ Authentication failed: Error Detected in output');
            throw new Error('Zigza Error or Invalid Code');
        }

        if (loginState === 'selection') {
            console.log('🔢 Multiple servers detected. Selecting target server...');

            // Use evaluate to parse the DOM directly and build a map
            const targetIndex = await page.evaluate((target) => {
                const text = document.getElementById('output')?.innerText || '';
                // Regex to capture: "1--> Server Name (ServerID)"
                // Matches: 1--> Server-Shard: 178 (E-18)
                // Also matches: 6--> Run in all servers (All of them)
                const regex = /(\d+)-->.*?\((.*?)\)/g;
                const map = {};
                let match;

                while ((match = regex.exec(text)) !== null) {
                    // match[1] = Index (e.g. "1")
                    // match[2] = Server ID (e.g. "E-18" or "All of them")
                    map[match[2].trim()] = match[1];
                }

                // Handle 'all' target
                if (target.toLowerCase() === 'all') {
                    return map['All of them'];
                }

                // Direct lookup
                if (map[target]) return map[target];

                // Case-insensitive lookup
                const lowerTarget = target.toLowerCase();
                for (const key in map) {
                    if (key.toLowerCase() === lowerTarget) return map[key];
                }

                return null;
            }, account.targetServer || '1');

            if (targetIndex) {
                console.log(`✅ Found target server "${account.targetServer}" at index ${targetIndex}. Selecting...`);
                await send(targetIndex, 3000);
            } else {
                console.log(`⚠️ Target server "${account.targetServer}" not found. defaulting to 1.`);
                await send('1', 3000);
            }
        } else if (loginState === 'success') {
            console.log('✅ Single server or auto-login detected.');
        } else {
            console.log('⚠️ Login state unclear/timed out. Proceeding...');
        }

        console.log('✅ Authentication flow complete.');

        // Step 3: THE BIG WAIT (Blind Wait for Dailies/Process)
        console.log('\n⏳ Step 3: Waiting 3 minutes 20 seconds (200s) for process to complete...');
        // We wait blindly as per "Better Flow" reference
        await new Promise(r => setTimeout(r, 200000));

        // Step 4: Rapid Fire Commands
        // Reference: ["y", "auto", "y", "quit", "y"]
        console.log('\n🚀 Step 4: Executing cleanup command sequence...');
        const commands = ["y", "auto", "y", "quit", "y"];

        for (const cmd of commands) {
            console.log(`📤 Sending: ${cmd}`);
            await send(cmd, 500); // 0.5s delay
        }

        // Step 5: Wait 60 Seconds before closing
        console.log('\n🛑 Step 5: Waiting 60 seconds before closing session...');
        await new Promise(r => setTimeout(r, 60000));

        console.log('✅ Session sequence complete.');
        await browser.close();
        return { success: true };


    } catch (error) {
        console.log('\n❌ ERROR OCCURRED\n💥 Error details:', error.message);
        console.log('='.repeat(60) + '\n');
        // Do not close browser here, let finally handle it
        return { success: false, reason: error.message };
    } finally {
        if (browser) {
            console.log('🛑 Closing browser (cleanup)...');
            try { await browser.close(); } catch (e) { console.log('Close error:', e.message); }
        }
    }
};
