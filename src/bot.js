import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import dotenv from 'dotenv';
import { addAccount, getAccounts, removeAccount, encrypt, setSchedule, pauseBot, resumeBot } from './db.js';
import { executeSession } from './manager.js';

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    new SlashCommandBuilder()
        .setName('add_account')
        .setDescription('Add a new game account')
        .addStringOption(option => option.setName('code').setDescription('Restore Code').setRequired(true))
        .addStringOption(option => option.setName('server').setDescription('Target Server (e.g., E-15, All)').setRequired(true))
        .addStringOption(option => option.setName('name').setDescription('Account Name').setRequired(true)),
    new SlashCommandBuilder()
        .setName('list_accounts')
        .setDescription('List all configured accounts'),
    new SlashCommandBuilder()
        .setName('force_run')
        .setDescription('Force run an account immediately')
        .addStringOption(option => option.setName('name').setDescription('Account Name to run').setRequired(true)),
    new SlashCommandBuilder()
        .setName('remove_account')
        .setDescription('Remove a game account')
        .addStringOption(option => option.setName('name').setDescription('Account Name to remove').setRequired(true)),
    new SlashCommandBuilder()
        .setName('set_schedule')
        .setDescription('Set the active hours for the bot')
        .addIntegerOption(option => option.setName('start_hour').setDescription('Start Hour (0-23)').setRequired(true))
        .addIntegerOption(option => option.setName('end_hour').setDescription('End Hour (0-23)').setRequired(true)),
    new SlashCommandBuilder()
        .setName('pause_bot')
        .setDescription('Pause the bot for X hours')
        .addIntegerOption(option => option.setName('hours').setDescription('Hours to pause (e.g. 1, 4, 12)').setRequired(true)),
    new SlashCommandBuilder()
        .setName('resume_bot')
        .setDescription('Resume bot operations immediately'),
    new SlashCommandBuilder()
        .setName('export_db')
        .setDescription('Download the current database file (Admin only)'),
];

client.once('ready', async () => {
    console.log(`[Discord] Logged in as ${client.user.tag}`);

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('[Discord] Refreshing application (/) commands.');
        // If GUILD_ID is set and not the placeholder, register to guild
        if (process.env.GUILD_ID && process.env.GUILD_ID !== 'your_guild_id_here') {
            await rest.put(Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID), { body: commands });
        } else {
            console.log('[Discord] Registering global commands (this may take a while to update)...');
            await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        }
        console.log('[Discord] Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    try {
        if (commandName === 'add_account') {
            const code = interaction.options.getString('code');
            const server = interaction.options.getString('server');
            const name = interaction.options.getString('name');

            // Encrypt the code before storing
            const encryptedCode = encrypt(code);
            await addAccount(name, encryptedCode, server);
            await interaction.reply({ content: `Account **${name}** added successfully!`, flags: MessageFlags.Ephemeral });
        }
        else if (commandName === 'list_accounts') {
            const accounts = await getAccounts();
            if (accounts.length === 0) {
                await interaction.reply('No accounts configured.');
                return;
            }

            // Chunk accounts to avoid exceeding embed limits
            const chunkSize = 15;
            for (let i = 0; i < accounts.length; i += chunkSize) {
                const chunk = accounts.slice(i, i + chunkSize);

                const embed = new EmbedBuilder()
                    .setTitle(i === 0 ? 'Configured Accounts' : 'Configured Accounts (Cont.)')
                    .setDescription(chunk.map(a =>
                        `**${a.name}** (Server: ${a.targetServer})\nStatus: ${a.status}\nLast Run: ${a.lastRun ? new Date(a.lastRun).toLocaleString() : 'Never'}`
                    ).join('\n\n'));

                if (i === 0) {
                    await interaction.reply({ embeds: [embed] });
                } else {
                    await interaction.followUp({ embeds: [embed] });
                }
            }
        }
        else if (commandName === 'force_run') {
            const name = interaction.options.getString('name');
            const accounts = await getAccounts();
            const account = accounts.find(a => a.name === name);

            if (!account) {
                await interaction.reply({ content: `Account **${name}** not found.`, flags: MessageFlags.Ephemeral });
                return;
            }

            await interaction.reply(`Starting session for **${name}**... Check console/logs for progress.`);

            // Run async, don't block reply
            executeSession(account.id).then(result => {
                if (result.success) {
                    interaction.followUp(`Session for **${name}** finished successfully.`).catch(console.error);
                } else {
                    interaction.followUp(`Session for **${name}** failed: ${result.message}`).catch(console.error);
                }
            }).catch(err => {
                console.error('[Discord] Force run error:', err);
                interaction.followUp(`Session for **${name}** failed due to an unexpected error.`).catch(console.error);
            });
        }
        else if (commandName === 'remove_account') {
            const name = interaction.options.getString('name');
            const removed = await removeAccount(name);

            if (removed) {
                await interaction.reply({ content: `Account **${name}** removed successfully.`, flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: `Account **${name}** not found.`, flags: MessageFlags.Ephemeral });
            }
        }
        else if (commandName === 'set_schedule') {
            const start = interaction.options.getInteger('start_hour');
            const end = interaction.options.getInteger('end_hour');

            if (start < 0 || start > 23 || end < 0 || end > 23) {
                await interaction.reply({ content: 'Hours must be between 0 and 23.', flags: MessageFlags.Ephemeral });
                return;
            }

            // Validation removed to allow cross-midnight schedules (e.g. 22:00 to 08:00)
            // if (start >= end) { ... }

            // Format as HH:00
            const startStr = `${start.toString().padStart(2, '0')}:00`;
            const endStr = `${end.toString().padStart(2, '0')}:00`;

            await setSchedule(startStr, endStr);
            await interaction.reply({ content: `✅ Schedule updated! Active hours: **${startStr}** to **${endStr}**` });
        }
        else if (commandName === 'pause_bot') {
            const hours = interaction.options.getInteger('hours');
            const pausedUntil = await pauseBot(hours);
            const date = new Date(pausedUntil).toLocaleString();
            await interaction.reply({ content: `⏸️ **Bot Paused!**\nNo daily runs will occur until: **${date}**` });
        }
        else if (commandName === 'resume_bot') {
            await resumeBot();
            await interaction.reply({ content: `▶️ **Bot Resumed!**\nDaily runs will continue as scheduled.` });
        }
        else if (commandName === 'export_db') {
            await interaction.reply({ content: '📤 Uploading database file...', files: ['./data/db.json'] });
        }
    } catch (error) {
        console.error('[Discord] Interaction Error:', error);
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            }
        } catch (handlerError) {
            // Ignore "Already acknowledged" errors, log others
            if (handlerError.code !== 40060) {
                console.error('[Discord] Error in error handler:', handlerError);
            }
        }
    }
});

export const startBot = () => {
    client.login(process.env.DISCORD_TOKEN).catch(err => {
        console.error('[Discord] Failed to login:', err);
    });
};

client.on('error', (error) => {
    console.error('[Discord] Client Error:', error);
});

export const sendLog = async (message, type = 'info') => {
    const channelId = process.env.LOG_CHANNEL_ID;
    if (!channelId) return; // No logging channel configured

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    let color = 0x0099ff; // Blue (Info)
    if (type === 'success') color = 0x00ff00; // Green
    if (type === 'error') color = 0xff0000; // Red
    if (type === 'start') color = 0xffff00; // Yellow

    const maxLength = 4000;
    const chunks = [];

    if (message.length <= maxLength) {
        chunks.push(message);
    } else {
        let currentChunk = '';
        // Split by lines to keep formatting clean
        const lines = message.split('\n');
        for (const line of lines) {
            // Check if adding this line exceeds the limit
            if ((currentChunk + line + '\n').length > maxLength) {
                chunks.push(currentChunk);
                currentChunk = line + '\n';
            } else {
                currentChunk += line + '\n';
            }
        }
        if (currentChunk.trim().length > 0) {
            chunks.push(currentChunk);
        }
    }

    for (const chunk of chunks) {
        // Double check chunk length just in case a single line is huge
        if (chunk.length > 4096) {
            // Fallback for extremely long single lines (rare)
            const subChunks = chunk.match(/.{1,4096}/g);
            for (const sub of subChunks) {
                const embed = new EmbedBuilder()
                    .setDescription(sub)
                    .setColor(color)
                    .setTimestamp();
                await channel.send({ embeds: [embed] }).catch(console.error);
            }
        } else {
            const embed = new EmbedBuilder()
                .setDescription(chunk)
                .setColor(color)
                .setTimestamp();
            await channel.send({ embeds: [embed] }).catch(console.error);
        }
    }
};
