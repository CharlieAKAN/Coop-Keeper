const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, AttachmentBuilder } = require('discord.js');

module.exports = {
    name: 'compile_submissions',
    data: new SlashCommandBuilder()
        .setName('compile_submissions')
        .setDescription('Randomly selects 1 submission')
        .addIntegerOption(option =>
            option.setName('hours')
                .setDescription('How many hours back to look for submissions')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('all')
                .setDescription('Retrieve all submissions instead of just one'))
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Max number of submissions per user (only used with "all")')),

    async execute(interaction) {
        // Role IDs allowed to use the command
        const allowedRoles = ['479806821008277554', '507112488127430677', '1345942031217852478'];

        // Check if the user has at least one of the allowed roles
        const memberRoles = interaction.member.roles.cache.map(role => role.id);
        if (!memberRoles.some(role => allowedRoles.includes(role))) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        const submissionChannel = interaction.channel; // Use the current channel
        const hours = interaction.options.getInteger('hours');
        const fetchAll = interaction.options.getBoolean('all') || false; // Default to false
        const maxPerUser = interaction.options.getInteger('limit') || 1; // Default to 1 if no limit is set

        const now = Date.now();
        const timeLimit = now - hours * 60 * 60 * 1000; // Convert hours to milliseconds

        // Fetch messages from the last X hours
        let allMessages = await submissionChannel.messages.fetch({ limit: 100 });
        allMessages = allMessages.filter(msg => msg.createdTimestamp >= timeLimit);

        if (allMessages.size === 0) {
            return interaction.reply({ content: 'No valid submissions found in this time range.', ephemeral: true });
        }

        let userSubmissions = {};

        // Process messages to extract valid submissions
        for (const message of allMessages.values()) {
            let extractedSubmissions = [];

            // Extract URLs from message content
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const foundLinks = message.content.match(urlRegex);
            if (foundLinks) {
                extractedSubmissions.push(...foundLinks);
            }

            // Extract attachments (images, files)
            message.attachments.forEach(attachment => {
                extractedSubmissions.push(attachment.url);
            });

            // If NO links or attachments, ignore the message
            if (extractedSubmissions.length === 0) {
                continue;
            }

            // Store valid submissions with user details
            if (!userSubmissions[message.author.id]) {
                userSubmissions[message.author.id] = [];
            }
            userSubmissions[message.author.id].push(...extractedSubmissions);
        }

        if (Object.keys(userSubmissions).length === 0) {
            return interaction.reply({ content: 'No valid submissions found (ignored text-only messages).', ephemeral: true });
        }

        if (fetchAll) {
            // Retrieve all valid submissions, limiting per user
            let embeds = [];
            let currentEmbed = new EmbedBuilder()
                .setTitle(`📜 All Submissions from #${submissionChannel.name}`)
                .setColor('#0099ff')
                .setDescription(`Pulled from the last **${hours} hours**.`)
                .setFooter({ text: 'Bot by Coop Keeper' });

            let hasEntries = false;
            let totalCharacterCount = 0;
            let textBackup = [];

            for (const userId in userSubmissions) {
                let userMessages = userSubmissions[userId];

                // Ensure we select only up to `maxPerUser` entries per user
                userMessages = userMessages.sort(() => Math.random() - 0.5).slice(0, maxPerUser);

                if (userMessages.length > 0) {
                    hasEntries = true;
                    let user = await interaction.guild.members.fetch(userId).catch(() => null);
                    let userName = user ? user.user.username : `Unknown (${userId})`;

                    const fieldContent = userMessages.map(msg => `- ${msg}`).join('\n') || '[No valid submissions]';
                    totalCharacterCount += fieldContent.length;

                    // Check if the embed exceeds the 6000-character limit
                    if (totalCharacterCount > 5500) {
                        // Store the data in a backup text file instead
                        textBackup.push(`User: ${userName}\n${fieldContent}\n\n`);
                    } else {
                        // Add to the current embed
                        currentEmbed.addFields({ name: `User: ${userName}`, value: fieldContent, inline: false });

                        // If the current embed is too long, store it and start a new one
                        if (totalCharacterCount > 5500) {
                            embeds.push(currentEmbed);
                            currentEmbed = new EmbedBuilder()
                                .setTitle(`📜 More Submissions`)
                                .setColor('#0099ff')
                                .setFooter({ text: 'Bot by Coop Keeper' });

                            totalCharacterCount = 0;
                        }
                    }
                }
            }

            // Push the final embed
            if (currentEmbed.data.fields?.length > 0) {
                embeds.push(currentEmbed);
            }

            if (!hasEntries) {
                return interaction.reply({ content: 'No valid submissions found.', ephemeral: true });
            }

            // If text backup is needed, send it as a file
            if (textBackup.length > 0) {
                const submissionText = textBackup.join('\n');
                const file = new AttachmentBuilder(Buffer.from(submissionText, 'utf-8'), { name: 'submissions.txt' });

                await interaction.reply({ content: 'Some submissions exceeded Discord’s embed limit. Here’s the full list:', files: [file] });
            } else {
                await interaction.reply({ embeds: embeds });
            }
        } else {
            // Pick ONE random submission from the entire pool
            const randomUserId = Object.keys(userSubmissions)[Math.floor(Math.random() * Object.keys(userSubmissions).length)];
            const randomSubmission = userSubmissions[randomUserId][Math.floor(Math.random() * userSubmissions[randomUserId].length)];

            let user = await interaction.guild.members.fetch(randomUserId).catch(() => null);
            let userName = user ? user.user.username : `Unknown (${randomUserId})`;

            let embed = new EmbedBuilder()
                .setTitle(`🎲 Random Submission from #${submissionChannel.name}`)
                .setColor('#0099ff')
                .setDescription(`Pulled from the last **${hours} hours**.`)
                .addFields({
                    name: `Submitted by ${userName}`,
                    value: `- ${randomSubmission}`
                })
                .setFooter({ text: 'Coop Keeper' });

            return interaction.reply({ embeds: [embed] });
        }
    }
};
