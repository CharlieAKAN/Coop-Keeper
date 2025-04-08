const { Client, GatewayIntentBits, Collection, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const cron = require('node-cron');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.commands = new Collection();

// Dynamically load commands
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
}

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // 1) Schedule the daily random reminder at 12 PM Central
    cron.schedule(
        '0 12 * * *', 
        async () => {
            try {
                // Make sure you have GUILD_ID in your .env
                const guildId = process.env.GUILD_ID;
                const reminderChannelId = process.env.REMINDER_CHANNEL_ID;

                if (!guildId || !reminderChannelId) {
                    console.error('Missing GUILD_ID or REMINDER_CHANNEL_ID in .env!');
                    return;
                }

                // Fetch the guild
                const guild = await client.guilds.fetch(guildId);
                // Fetch all members (be mindful if your server is huge)
                const members = await guild.members.fetch();
                // Pick one random member
                const randomMember = members.random();

                // Fetch the channel to send the reminder
                const reminderChannel = await client.channels.fetch(reminderChannelId);
                if (!reminderChannel) {
                    console.error('Reminder channel not found!');
                    return;
                }

                // Send the daily reminder
                await reminderChannel.send(
                    `Hey ${randomMember}, have you hydrated today? ☀️💧`
                );
            } catch (error) {
                console.error('Error with daily water reminder:', error);
            }
        },
        {
            scheduled: true,
            timezone: 'America/Chicago' // Runs daily at 12 PM CT
        }
    );

    // 2) Schedule the Sunday leaderboard reset for 12 PM Central
    cron.schedule(
        '0 12 * * 0', 
        async () => {
            try {
                // 1) Read the final scoreboard
                const dataFilePath = path.join(__dirname, 'data', 'waterData.json');
                
                let embedDescription = '';
                let data = {};

                // Check if our data file exists
                if (fs.existsSync(dataFilePath)) {
                    data = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));

                    const leaderboardArray = Object.entries(data).map(([userId, info]) => {
                        return { userId, total: info.total };
                    });

                    // Sort descending by total
                    leaderboardArray.sort((a, b) => b.total - a.total);

                    if (leaderboardArray.length === 0) {
                        embedDescription = 'No data this week!';
                    } else {
                        // Build the leaderboard text
                        for (let i = 0; i < leaderboardArray.length; i++) {
                            const { userId, total } = leaderboardArray[i];
                            embedDescription += `**${i + 1}.** <@${userId}> - ${total} oz\n`;
                        }
                    }
                } else {
                    embedDescription = 'No data this week!';
                }

                // 2) Build the embed
                const embed = new EmbedBuilder()
                    .setTitle('💧Weekly Water Leaderboard - Final💧')
                    .setColor(0x1E90FF)
                    .setDescription(embedDescription);

                // 3) Post to the channel
                const channel = await client.channels.fetch(process.env.WATER_LEADERBOARD_CHANNEL_ID);
                if (channel) {
                    // Send the embed
                    await channel.send({ embeds: [embed] });
                }

                // 4) Reset data for the new week
                fs.writeFileSync(dataFilePath, JSON.stringify({}));
                
            } catch (error) {
                console.error('Error with weekly leaderboard reset:', error);
            }
        },
        {
            scheduled: true,
            timezone: 'America/Chicago' // Forces Sunday 12 PM Central Time
        }
    );
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        await interaction.reply({
            content: 'There was an error executing this command!',
            ephemeral: true
        });
    }
});

client.login(process.env.TOKEN);
