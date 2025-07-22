const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const cron = require('node-cron');
const reminderWater = require('./reminder_water.js');
const { handleMessage, handleVoice, init: initLevels } = require('./commands/levelSystem');
const noLeveling = require('./commands/no_leveling.js');

// const sessionFilePath = path.join(__dirname, 'data', 'session.json');
// const charactersFilePath = path.join(__dirname, 'data', 'characters.json');
// const actionsFilePath = path.join(__dirname, 'data', 'actions.json');

const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers
    ]
});

client.commands = new Collection();

const commandFiles = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);

  // only load real slash‑command modules
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
  } else {
    console.log(`[loader] Skipped ${file} – not a slash command`);
  }
}

client.once('ready', async () => {
    
    console.log(`Logged in as ${client.user.tag}!`);

  // ── NEW: warm‑up presence cache for every guild ──
  for (const [id, guild] of client.guilds.cache) {
    await guild.members.fetch({ withPresences: true }).catch(console.error);
  }

    cron.schedule('0 12 * * 0', async () => {
        try {
            const dataFilePath = path.join(__dirname, 'data', 'waterData.json');
            let finalTotal = 0;

            if (fs.existsSync(dataFilePath)) {
                const data = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
                finalTotal = data.total || 0;
            }

            const weeklyGoal = parseInt(process.env.WEEKLY_WATER_GOAL) || 5000;
            let resultDescription = `We aimed for **${weeklyGoal} oz** this week. We reached **${finalTotal} oz**!`;

            if (finalTotal >= weeklyGoal) {
                const overage = finalTotal - weeklyGoal;
                resultDescription += `\n**Goal met!** We even went over by **${overage} oz**! Great job!`;
            } else {
                const short = weeklyGoal - finalTotal;
                resultDescription += `\nWe were **${short} oz** short, but let’s crush it next week!`;
            }

            const embed = new EmbedBuilder()
                .setTitle('💧 Weekly Water Goal - Final 🏁')
                .setColor(0x1E90FF)
                .setDescription(resultDescription);

            const channel = await client.channels.fetch(process.env.WATER_LEADERBOARD_CHANNEL_ID);
            if (channel) {
                await channel.send({ embeds: [embed] });
            }

            fs.writeFileSync(dataFilePath, JSON.stringify({ total: 0 }));

        } catch (error) {
            console.error('Error with weekly water goal reset:', error);
        }
    }, {
        scheduled: true,
        timezone: 'America/Chicago'
    });
});

const WHITELIST = {
  // DiscordUserID: 'TheirTwitchURL',
  '122508161004470272': 'https://www.twitch.tv/bug_exe404',
  '757725448573812906': 'https://twitch.tv/bellstar20',
  '725205485506265098': 'https://www.twitch.tv/monkedmelly',
  '141814358664544256': 'https://www.twitch.tv/excalitrash',
  '332293963291557889': 'https://www.twitch.tv/kirozeru',
  '550366602734862383': 'https://www.twitch.tv/007allmight/',
  // …add as many as you like
};


client.on('presenceUpdate', async (oldP, newP) => {
  const member = newP.member;
  if (!member) return;

  const sourceRoleId    = '1397318388874875004';             // your original gatekeeper role
  const announceChannel = await client.channels.fetch('1397288220668072139');

  // Check if they’re whitelisted, or have the role
  const isWhitelisted = Boolean(WHITELIST[member.user.id]);
  const hasSourceRole = member.roles.cache.has(sourceRoleId);
  if (!isWhitelisted && !hasSourceRole) return;

  // Did they just go live?
  const wasStreaming = oldP?.activities?.some(a => a.type === ActivityType.Streaming);
  const isStreaming  = newP.activities.some(a => a.type === ActivityType.Streaming);

  if (!wasStreaming && isStreaming) {
    // Grab the Discord Stream activity if they’re using the integration
    const streamAct = newP.activities.find(a => a.type === ActivityType.Streaming);
    const streamTitle = streamAct?.state || 'their stream';

    // Determine which URL to use:
    // 1) Whitelist overrides everything
    // 2) Then saved /twitchlink JSON
    // 3) Then Discord’s built‑in streamAct.url
    // 4) Then fallback to username
    let twitchUrl = WHITELIST[member.user.id]
      || (() => {
        // try your stored JSON
        try {
          const storePath = path.join(__dirname, 'data', 'twitchLinks.json');
          if (fs.existsSync(storePath)) {
            const map = JSON.parse(fs.readFileSync(storePath, 'utf8'));
            if (map[member.user.id]) return map[member.user.id];
          }
        } catch (e) {
          console.warn('Couldn’t read Twitch link store:', e);
        }
        return streamAct?.url || `https://twitch.tv/${member.user.username}`;
      })();

    // Build & send the embed
    try {
      await announceChannel.send({
        embeds: [
          new EmbedBuilder()
            .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
            .setColor(0x9146FF) // Twitch purple
            .setTitle(`🔴 ${member.user.username} is now LIVE!`)
            .setDescription(`**${streamTitle}**\n[Watch on Twitch](${twitchUrl})`)
            .setTimestamp()
        ]
      });
      console.log(`Announced stream for ${member.user.tag}`);
    } catch (err) {
      console.error('Failed to announce stream:', err);
    }
  }
});




function saveSession(session) {
    fs.writeFileSync(sessionFilePath, JSON.stringify(session, null, 2));
}

function safeDiscordContent(str, suffix = '… (truncated)') {
    if (!str || str.length <= 2000) return str;
    return str.slice(0, 2000 - suffix.length) + suffix;
}

client.on('messageCreate', handleMessage);
client.on('voiceStateUpdate', handleVoice);


client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith('roll_dice_')) {
        const parts = interaction.customId.split('_');
        const userId = parts[2];

        if (interaction.user.id !== userId) {
            await interaction.reply({ content: '🚫 Only the player who took the action can roll this dice!', ephemeral: true });
            return;
        }

        await interaction.deferReply();

        let session = {};
        if (fs.existsSync(sessionFilePath)) {
            session = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
        }
        if (!session.pendingRoll || session.pendingRoll.userId !== userId) {
            await interaction.editReply({ content: 'No pending roll for you!' });
            return;
        }

        let { player, action, party, location, situation, npc_focus } = session.pendingRoll;

        if (!player) {
            let characters = [];
            if (fs.existsSync(charactersFilePath)) {
                characters = JSON.parse(fs.readFileSync(charactersFilePath, 'utf8'));
            }
            const fallbackPlayer = characters.find(c => c.userId === userId || c.userId === interaction.user.id);
            if (!fallbackPlayer) {
                await interaction.editReply({ content: 'Player data missing. Try rejoining the adventure.' });
                delete session.pendingRoll;
                saveSession(session);
                return;
            }
            player = fallbackPlayer;
        }

        party = party || [];
        location = location || "Unknown";
        situation = situation || "Unknown";
        npc_focus = npc_focus || "Unknown";
        action = action || "an action";

        const roll = Math.floor(Math.random() * 20) + 1;

        const partyListString = (party && party.length)
            ? party.map(p => `${p.name} the ${p.class}`).join(', ')
            : `${player.name} the ${player.class}`;

        const rollPrompt = `You are a D&D Dungeon Master.\nThe player attempted: "${action}"\nThey rolled a d20 and got: ${roll}\nCurrent Party: ${partyListString}\nLocation: ${location}\nSituation: ${situation}\nNPC Focus: ${npc_focus}\nDescribe the outcome based on a D&D skill/attack check, including success/failure and impact on the scene.\nDescribe the outcome in 2–4 sentences.`;

        let resultNarrative = '';
        try {
            const resultRes = await openai.chat.completions.create({
                model: 'o3-mini-2025-01-31',
                messages: [
                    { role: 'system', content: 'Narrate the D&D outcome based on dice roll.' },
                    { role: 'user', content: rollPrompt }
                ],
            });
            resultNarrative = resultRes.choices[0].message.content;
        } catch (e) {
            resultNarrative = `You rolled a **${roll}**! (But something went wrong with the narration...)`;
        }

        let actions = [];
        if (fs.existsSync(actionsFilePath)) {
            actions = JSON.parse(fs.readFileSync(actionsFilePath, 'utf8'));
        }
        actions.push({
            timestamp: new Date().toISOString(),
            type: 'dice-roll',
            userId: player.userId || interaction.user.id,
            character: { name: player.name, class: player.class },
            action,
            roll,
            outcome: resultNarrative,
            location,
            situation,
            npc_focus
        });
        fs.writeFileSync(actionsFilePath, JSON.stringify(actions, null, 2));

        delete session.pendingRoll;
        saveSession(session);

        await interaction.editReply({
            content: safeDiscordContent(`🎲 **${player.name}** the *${player.class}* rolled a **${roll}**!\n\n${resultNarrative}`)
        });
        return;
    }

    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            await interaction.reply({
                content: 'There was an error executing this command!',
                ephemeral: false
            });
        }
    }
});

client.login(process.env.TOKEN);
