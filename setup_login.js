import puppeteer from 'puppeteer';
import fs from 'fs';

const GAME_URL = 'https://evertext.sytes.net/';

(async () => {
    console.log('🔵 Launching browser for manual login...');
    console.log('👉 Please login with Discord in the opened window.');
    console.log('👉 Once you see the "Terminal" or "Game" screen, return here.');

    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: null
    });

    const page = await browser.newPage();
    // Use EXACTLY the same User-Agent as the bot to ensure session validity
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        await page.goto(GAME_URL, { waitUntil: 'networkidle2' });

        console.log('⏳ Waiting for you to reach the main game screen...');
        console.log('👉 Login with Discord. If stuck on "redirecting", just wait.');
        console.log('🛑 WHEN YOU ARE SUCCESFULLY LOGGED IN and see the game/terminal:');
        console.log('⌨️  Press [ENTER] in this terminal to save cookies and close.');

        // Wait for manual user confirmation
        const readline = (await import('readline')).createInterface({
            input: process.stdin,
            output: process.stdout
        });

        await new Promise(resolve => readline.question('', resolve));
        readline.close();

        console.log('✅ Game screen detected! Waiting 3 seconds to ensure cookies settle...');
        await new Promise(r => setTimeout(r, 3000));

        // Get cookies
        const cookies = await page.cookies();
        fs.writeFileSync('./data/cookies.json', JSON.stringify(cookies, null, 2));

        console.log(`💾 Saved ${cookies.length} cookies to data/cookies.json`);
        console.log('🎉 Cookies refreshed. Please push this file to GitHub now.');

    } catch (e) {
        console.error('❌ Error:', e);
    } finally {
        await browser.close();
    }
})();
