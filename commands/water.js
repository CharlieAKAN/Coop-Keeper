const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Path to the JSON where we'll store weekly data
const dataFilePath = path.join(__dirname, '..', 'data', 'waterData.json');

// Helper function to load the data
function loadData() {
    try {
        // Make sure the folder exists
        fs.mkdirSync(path.dirname(dataFilePath), { recursive: true });

        if (!fs.existsSync(dataFilePath)) {
            fs.writeFileSync(dataFilePath, JSON.stringify({}));
        }
        const rawData = fs.readFileSync(dataFilePath, 'utf8');
        return JSON.parse(rawData);
    } catch (err) {
        console.error('Error reading water data:', err);
        return {};
    }
}

// Helper function to save the data
function saveData(data) {
    try {
        // Make sure the folder exists
        fs.mkdirSync(path.dirname(dataFilePath), { recursive: true });

        fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error writing water data:', err);
    }
}

// Build the slash commands
module.exports = {
    data: new SlashCommandBuilder()
        .setName('water')
        .setDescription('Track your water intake.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add water intake in ounces (oz).')
                .addIntegerOption(option =>
                    option
                        .setName('amount')
                        .setDescription('How many oz of water you drank?')
                        .setRequired(true),
                ))
        .addSubcommand(subcommand =>
            subcommand
                .setName('leaderboard')
                .setDescription('Show the current weekly water leaderboard.'),
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const data = loadData();

        switch (subcommand) {
            case 'add': {
                const amount = interaction.options.getInteger('amount');
                const userId = interaction.user.id;

                // If user hasn't recorded any water yet this week, start at 0
                if (!data[userId]) {
                    data[userId] = { total: 0 };
                }

                // Increment their total by the specified amount
                data[userId].total += amount;

                // Save data
                saveData(data);

                // Build embed
                const embed = new EmbedBuilder()
                    .setTitle('💧Hydration Station!🥤')
                    .setColor(0x00FF00) // pick any embed color you like
                    .setDescription(
                        `You just added **${amount} oz** of water to your daily tally!\n\n` +
                        `**Current Weekly Total:** ${data[userId].total} oz\n\n` +
                        `Keep it up! Remember, staying hydrated can boost your energy, mood, and overall health.\n\n` +
                        `Anyone can use command </water:1358968131397091409> to be added to the water leaderboard!`
                    );

                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'leaderboard': {
                // Build an array of [userId, total]
                const leaderboardArray = Object.entries(data).map(([userId, info]) => {
                    return { userId, total: info.total };
                });

                // Sort descending by total
                leaderboardArray.sort((a, b) => b.total - a.total);

                if (leaderboardArray.length === 0) {
                    await interaction.reply('No data yet for this week!');
                    return;
                }

                // Create a text string to show the standings
                let leaderboardText = '';
                for (let i = 0; i < leaderboardArray.length; i++) {
                    const { userId, total } = leaderboardArray[i];
                    const userTag = `<@${userId}>`;
                    leaderboardText += `**${i + 1}.** ${userTag} - ${total} oz\n`;
                }

                // Build embed
                const embed = new EmbedBuilder()
                    .setTitle('💧Weekly Water Leaderboard💧')
                    .setColor(0x1E90FF)
                    .setDescription(
                        leaderboardText + 
                        '\n\n**Stay hydrated, stay healthy!**'
                    );

                await interaction.reply({ embeds: [embed] });
                break;
            }

            default: {
                await interaction.reply('Unknown subcommand for /water');
            }
        }
    },
};
