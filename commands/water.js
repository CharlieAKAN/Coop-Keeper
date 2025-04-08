const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Location of your data file
const dataFilePath = path.join(__dirname, '..', 'data', 'waterData.json');

// Create or load data
function loadData() {
    try {
        fs.mkdirSync(path.dirname(dataFilePath), { recursive: true });
        if (!fs.existsSync(dataFilePath)) {
            // We'll store:
            // {
            //   "total": 0,        // Guild-wide total
            //   "users": {}        // Per-user totals
            // }
            fs.writeFileSync(dataFilePath, JSON.stringify({ total: 0, users: {} }));
        }
        const raw = fs.readFileSync(dataFilePath, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        console.error('Error loading water data:', err);
        // Fallback if something goes wrong
        return { total: 0, users: {} };
    }
}

function saveData(data) {
    try {
        fs.mkdirSync(path.dirname(dataFilePath), { recursive: true });
        fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error saving water data:', err);
    }
}

// Build a water-progress bar with emojis
function createWaterProgressBar(current, goal, length = 10) {
    const ratio = current / goal;
    const filledSlots = Math.min(length, Math.round(ratio * length));
    const emptySlots = length - filledSlots;

    // Use 💧 for filled, ⬜ for empty
    const bar = '💧'.repeat(filledSlots) + '⬜'.repeat(emptySlots);
    return bar;
}

// Random motivational lines
const motivationLines = [
    "Remember, water is life!",
    "Stay hydrated, champion!",
    "Your body thanks you for the H2O!",
    "Hydration heroes never quit!",
    "You're basically an aquatic superhero now!"
];

// Weekly goal from .env or fallback to 5000
const weeklyGoal = parseInt(process.env.WEEKLY_WATER_GOAL) || 5000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('water')
        .setDescription('Track your guild’s weekly water goal (with individual contributions).')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add water intake (oz) to the guild total.')
                .addIntegerOption(option =>
                    option
                        .setName('amount')
                        .setDescription('Number of ounces to add')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('goal')
                .setDescription('Show progress toward the weekly water goal.')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const data = loadData();

        // Ensure data.users exists
        if (!data.users) data.users = {};
        // Also ensure data.total is a number
        if (typeof data.total !== 'number') data.total = 0;

        switch (subcommand) {
            case 'add': {
                const amount = interaction.options.getInteger('amount');
                const userId = interaction.user.id;

                // 1) Increment guild total
                data.total += amount;

                // 2) Increment user's personal total
                if (!data.users[userId]) {
                    data.users[userId] = 0;
                }
                data.users[userId] += amount;

                saveData(data);

                // Get user’s total
                const userTotal = data.users[userId];

                // Random motivational line
                const randomIndex = Math.floor(Math.random() * motivationLines.length);
                const randomMotivation = motivationLines[randomIndex];

                // Build an embed response
                const embed = new EmbedBuilder()
                    .setTitle('💧 Hydration Station! 🥤')
                    .setColor(0x00FFFF)
                    .setDescription(
                        `You just added **${amount} oz**!\n\n` +
                        `**Your Total This Week:** ${userTotal} oz\n` +
                        `**Coop Total:** ${data.total} / ${weeklyGoal} oz\n\n` +
                        `${randomMotivation}\n\n` +
                        `**Anyone can add to the water goal using </water add:1358968131397091409>!**`
                    );

                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'goal': {
                // Show a progress bar for the guild total
                const bar = createWaterProgressBar(data.total, weeklyGoal, 10);

                const embed = new EmbedBuilder()
                    .setTitle('💧Weekly Water Goal Progress🌟')
                    .setColor(0x1E90FF)
                    .setDescription(
                        `**Goal:** ${weeklyGoal} oz\n` +
                        `**Current Coop Total:** ${data.total} oz\n\n` +
                        `${bar}\n\n` +
                        `Keep going! Every drop counts!`
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
