# EverText Auto Bot 🤖

A Discord bot that automates daily tasks for the EverText game terminal. Optimized for 24/7 deployment on Zeabur's free tier.

## Features

- 🔐 **Secure Account Storage**: Restore codes are encrypted using AES encryption
- ⏰ **Scheduled Automation**: Runs accounts daily between 10:00-20:00
- 🎯 **Smart Server Selection**: Automatically selects your target game server
- 📊 **Discord Commands**: Easy account management via Discord slash commands
- 🚀 **Resource Optimized**: Lightweight configuration for free-tier hosting
- 🔄 **Auto-Migration**: Automatically upgrades database on startup

## Discord Commands

- `/add_account` - Add a new game account with restore code
- `/list_accounts` - View all configured accounts and their status
- `/force_run` - Manually trigger automation for an account
- `/remove_account` - Remove an account from the bot

## Quick Start

### 1. Prerequisites

- Node.js 18+ 
- A Discord bot token ([Create one here](https://discord.com/developers/applications))
- Your game restore code(s)

### 2. Installation

```bash
npm install
```

### 3. Configuration

Copy `.env.example` to `.env` and fill in your details:

```env
DISCORD_TOKEN=your_discord_bot_token_here
ENCRYPTION_KEY=your_secure_random_string_32_chars_minimum
GUILD_ID=your_guild_id_here  # Optional
```

### 4. Run Locally

```bash
npm start
```

## Zeabur Deployment (Free Tier) 🌐

This bot is optimized for Zeabur's free tier with minimal resource usage.

### Resource Usage
- **Idle**: ~50-80MB RAM
- **Active (running automation)**: ~150-250MB RAM
- **CPU**: Spikes during automation, otherwise minimal

### Deploy to Zeabur

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

2. **Connect to Zeabur**
   - Go to [Zeabur](https://zeabur.com)
   - Create a new project
   - Connect your GitHub repository
   - Zeabur will auto-detect Node.js

3. **Set Environment Variables**
   - In Zeabur dashboard, go to your service
   - Add environment variables:
     - `DISCORD_TOKEN`
     - `ENCRYPTION_KEY`
     - `GUILD_ID` (optional)

4. **Deploy!**
   - Zeabur will automatically build and deploy
   - Bot will start and run 24/7

### Memory Optimizations Include:
- Puppeteer configured with `--disable-dev-shm-usage`
- Resource blocking (images, fonts, media)
- Smaller browser viewport (800x600)
- Single concurrent session enforcement
- Efficient 10-minute scheduling intervals

## How It Works

1. **Scheduled Checks**: Every 10 minutes during 10:00-20:00
2. **Account Selection**: Finds accounts that haven't run today
3. **Terminal Automation**: 
   - Opens EverText terminal
   - Sends 'd' command
   - Enters restore code (decrypted)
   - Selects target server
   - Game runs automatically
4. **Completion**: Updates database when account finishes

## Database

Account data is stored in `db.json` with encrypted restore codes:

```json
{
  "accounts": [
    {
      "id": "1234567890",
      "name": "Account Name",
      "encryptedCode": "U2FsdGVkX1/...",
      "targetServer": "E-15",
      "lastRun": "2025-11-27T02:00:00.000Z",
      "status": "idle"
    }
  ]
}
```

## Security

- ✅ Restore codes encrypted with AES-256
- ✅ Environment variables for sensitive data
- ✅ Auto-migration encrypts existing plain-text codes
- ✅ `.gitignore` prevents committing secrets

## Troubleshooting

### Bot not responding to commands
- Check bot has proper permissions in your Discord server
- Ensure `DISCORD_TOKEN` is correct
- Commands may take up to 1 hour to register globally (use `GUILD_ID` for instant updates)

### Memory issues on Zeabur
- Ensure only one account runs at a time
- Check scheduler isn't running too frequently
- Monitor Zeabur dashboard for resource usage

### Authentication failures
- Verify restore code is correct
- Check if code is properly encrypted in `db.json`
- Look for error messages in logs

## Development

Run in development mode:
```bash
npm start
```

The bot will:
- Run database migration on startup
- Register Discord commands
- Start the scheduler
- Log all activities to console

## Support

For issues or questions, check the logs:
- `[DB]` - Database operations
- `[Manager]` - Session scheduling
- `[Runner]` - Game automation
- `[Discord]` - Bot commands

## License

ISC
