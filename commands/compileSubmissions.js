const { 
    SlashCommandBuilder, 
    PermissionsBitField, 
    EmbedBuilder, 
    AttachmentBuilder 
} = require('discord.js');

module.exports = {
    name: 'compile_submissions',
    data: new SlashCommandBuilder()
        .setName('compile_submissions')
        .setDescription('Randomly selects 1 submission (or all) with no duplicates & no consecutive repeats.')
        .addIntegerOption(option =>
            option.setName('hours')
                .setDescription('How many hours back to look for submissions')
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option.setName('all')
                .setDescription('Retrieve all submissions instead of just one')
        )
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Max number of submissions per user (only used with "all")')
        ),

    async execute(interaction) {
        // Role IDs allowed to use the command
        const allowedRoles = [
            '479806821008277554', 
            '507112488127430677', 
            '1345942031217852478',
            '1094860110733516881'
        ];

        // Check if the user has at least one of the allowed roles
        const memberRoles = interaction.member.roles.cache.map(role => role.id);
        if (!memberRoles.some(role => allowedRoles.includes(role))) {
            return interaction.reply({ 
                content: 'You do not have permission to use this command.', 
                ephemeral: true 
            });
        }

        const submissionChannel = interaction.channel; // The current channel
        const hours = interaction.options.getInteger('hours');
        const fetchAll = interaction.options.getBoolean('all') || false; // Default false
        const maxPerUser = interaction.options.getInteger('limit') || 1;  // Default 1

        // Calculate time limit
        const now = Date.now();
        const timeLimit = now - hours * 60 * 60 * 1000; // X hours in ms

        // Fetch last 100 messages, filter by timeframe
        let allMessages = await submissionChannel.messages.fetch({ limit: 100 });
        allMessages = allMessages.filter(msg => msg.createdTimestamp >= timeLimit);

        if (allMessages.size === 0) {
            return interaction.reply({ 
                content: 'No valid submissions found in this time range.', 
                ephemeral: true 
            });
        }

        // userSubmissions: { userID: Set(submissions) }
        let userSubmissions = {};

        // Extract links/attachments. Ignore pure text.
        for (const message of allMessages.values()) {
            const userId = message.author.id;

            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const foundLinks = message.content.match(urlRegex) || [];

            const attachmentLinks = [];
            message.attachments.forEach(attach => {
                attachmentLinks.push(attach.url);
            });

            // Combined valid submissions
            const combined = [...foundLinks, ...attachmentLinks];
            if (combined.length === 0) continue; // Skip if no links/attachments

            // Ensure we have a Set to avoid duplicates
            if (!userSubmissions[userId]) {
                userSubmissions[userId] = new Set();
            }

            for (const sub of combined) {
                userSubmissions[userId].add(sub);
            }
        }

        // Remove users with no submissions (just in case)
        for (const [uid, setOfSubs] of Object.entries(userSubmissions)) {
            if (!setOfSubs || setOfSubs.size === 0) {
                delete userSubmissions[uid];
            }
        }

        if (Object.keys(userSubmissions).length === 0) {
            return interaction.reply({ 
                content: 'No valid submissions found (duplicates or text-only?).', 
                ephemeral: true 
            });
        }

        //
        // If NOT "all": pick ONE random submission from ONE random user
        //
        if (!fetchAll) {
            const allUserIds = Object.keys(userSubmissions);
            const randomUserId = allUserIds[Math.floor(Math.random() * allUserIds.length)];

            // Convert the Set to an array
            const arrSubs = [...userSubmissions[randomUserId]];
            const randomSubmission = arrSubs[Math.floor(Math.random() * arrSubs.length)];

            let user = await interaction.guild.members.fetch(randomUserId).catch(() => null);
            let userName = user ? user.user.username : `Unknown (${randomUserId})`;

            let embed = new EmbedBuilder()
                .setTitle(`🎲 Random Submission from #${submissionChannel.name}`)
                .setColor('#0099ff')
                .setDescription(`Pulled from the last **${hours} hours**, ignoring duplicates/text.`)
                .addFields({
                    name: `Submitted by ${userName}`,
                    value: `- ${randomSubmission}`
                })
                .setFooter({ text: 'Coop Keeper' });

            return interaction.reply({ embeds: [embed] });
        }

        //
        // "ALL" Mode => Round-Robin style to avoid consecutive same user
        //
        // Step 1: Build an object userId -> arrayOfSubs
        //         Shuffle each user's array, limit to maxPerUser
        let userArrays = {};
        for (const [uid, subsSet] of Object.entries(userSubmissions)) {
            let subsArr = [...subsSet];
            // Shuffle
            subsArr.sort(() => Math.random() - 0.5);
            // Slice to maxPerUser
            subsArr = subsArr.slice(0, maxPerUser);
            if (subsArr.length > 0) {
                userArrays[uid] = subsArr;
            }
        }

        // If no entries after limiting
        if (Object.keys(userArrays).length === 0) {
            return interaction.reply({ 
                content: 'No submissions left after applying per-user limit.', 
                ephemeral: true 
            });
        }

        // Step 2: Round-robin approach:
        //   In each "round," we take ONE submission from every user that still has any left,
        //   shuffle that round so user order is random, then add to final array.
        //   This ensures we won't see the same user consecutively within that round,
        //   and we won't see the same user again until the next round (i.e., all other users are used).
        let finalPairs = []; // array of { userId, submission }
        while (true) {
            // Gather all users who still have submissions
            let activeUsers = Object.keys(userArrays).filter(uid => userArrays[uid].length > 0);
            if (activeUsers.length === 0) break; // no more submissions left

            // Build the "round"
            let thisRound = [];
            for (const uid of activeUsers) {
                // Pop 1 submission from them
                const sub = userArrays[uid].pop();
                thisRound.push({ userId: uid, submission: sub });
            }

            // Shuffle the "round"
            thisRound.sort(() => Math.random() - 0.5);

            // Append to final
            finalPairs.push(...thisRound);
        }

        // Step 3: Build embeddings from finalPairs
        let embeds = [];
        let currentEmbed = new EmbedBuilder()
            .setTitle(`📜 All Submissions from #${submissionChannel.name}`)
            .setColor('#0099ff')
            .setDescription(`Pulled from the last **${hours} hours**, ignoring duplicates & text.`)
            .setFooter({ text: 'Bot by Coop Keeper' });

        let totalCharCount = 0;
        let textBackup = [];
        // We'll cache user names to avoid multiple fetches
        let userNameCache = {};

        for (const pair of finalPairs) {
            if (!userNameCache[pair.userId]) {
                let member = await interaction.guild.members.fetch(pair.userId).catch(() => null);
                userNameCache[pair.userId] = member ? member.user.username : `Unknown (${pair.userId})`;
            }
            const fieldName = `User: ${userNameCache[pair.userId]}`;
            const fieldValue = `- ${pair.submission}`;
            const newLen = fieldName.length + fieldValue.length;

            if (totalCharCount + newLen > 5500) {
                // Overflow potential => store in text file
                textBackup.push(`${fieldName}\n${fieldValue}\n`);
            } else {
                currentEmbed.addFields({ name: fieldName, value: fieldValue, inline: false });
                totalCharCount += newLen;
                if (totalCharCount > 5500) {
                    // push & reset
                    embeds.push(currentEmbed);
                    currentEmbed = new EmbedBuilder()
                        .setTitle(`📜 More Submissions`)
                        .setColor('#0099ff')
                        .setFooter({ text: 'Bot by Coop Keeper' });
                    totalCharCount = 0;
                }
            }
        }

        // Push the last embed if it has fields
        if (currentEmbed.data.fields && currentEmbed.data.fields.length > 0) {
            embeds.push(currentEmbed);
        }

        if (embeds.length === 0 && textBackup.length === 0) {
            return interaction.reply({ 
                content: 'No valid final submissions after formatting.', 
                ephemeral: true 
            });
        }

        if (textBackup.length > 0) {
            // We have leftover text
            const bigText = textBackup.join('\n');
            const file = new AttachmentBuilder(Buffer.from(bigText, 'utf-8'), { name: 'submissions_overflow.txt' });
            if (embeds.length > 0) {
                await interaction.reply({
                    content: 'Some submissions exceeded the embed limit. See embed & attached file:',
                    embeds: embeds,
                    files: [file]
                });
            } else {
                await interaction.reply({
                    content: 'All submissions exceeded the embed limit. Full list in the attached file:',
                    files: [file]
                });
            }
        } else {
            // Everything fit in embeds
            await interaction.reply({ embeds: embeds });
        }
    }
};
