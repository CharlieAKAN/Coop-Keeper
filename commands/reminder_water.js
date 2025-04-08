const cron = require('node-cron');

module.exports = (client) => {
    // Schedule a job every day at 12 PM Central Time
    cron.schedule(
        '0 12 * * *',
        async () => {
            try {
                // 1) Fetch the guild by ID
                //    Make sure you define GUILD_ID in your .env if you have multiple servers
                const guild = await client.guilds.fetch(process.env.GUILD_ID);

                // 2) Fetch all members
                const members = await guild.members.fetch();

                // 3) Pick a random member
                //    If your server is huge, keep in mind this fetch is large. 
                //    But for smaller servers it’s fine.
                const randomMember = members.random();

                // 4) Fetch the channel where you want to send the reminder
                //    We can reuse WATER_LEADERBOARD_CHANNEL_ID or define a new env var, e.g. REMINDER_CHANNEL_ID
                const channel = await client.channels.fetch(process.env.WATER_LEADERBOARD_CHANNEL_ID);
                if (!channel) return;

                // 5) Send the daily reminder
                await channel.send(`Hey ${randomMember}, have you hydrated today? ☀️💧`);
            } catch (error) {
                console.error('Error with daily water reminder:', error);
            }
        },
        {
            scheduled: true,
            timezone: 'America/Chicago', // Ensures it runs at 12 PM Central Time
        }
    );
};
