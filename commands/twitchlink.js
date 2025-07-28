// commands/twitchlink.js
const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Path to your JSON store (create a data/ folder if you don’t have one)
const STORE = path.join(__dirname, '../data/twitchLinks.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('twitchlink')
    .setDescription('📺 Register your Twitch channel URL for play announcements')
    .addStringOption(opt =>
      opt
        .setName('url')
        .setDescription('Full URL to your Twitch channel (e.g. https://twitch.tv/you)')
        .setRequired(true)
    ),
  async execute(interaction) {
    const url = interaction.options.getString('url');

    let map = {};
    if (fs.existsSync(STORE)) {
      try {
        map = JSON.parse(fs.readFileSync(STORE, 'utf8'));
      } catch {}
    }

    map[interaction.user.id] = url;
    fs.writeFileSync(STORE, JSON.stringify(map, null, 2));

    await interaction.reply({
      content: `✅ Got it! I’ll use **${url}** when announcing you streaming.\n\n⚠️**MAKE SURE**⚠️\n - 1) Streamer Mode is on in your Discord settings \n - 2) Activity Privacy is set to Share Your Detected Activities with Others in your Discord settings \n\n🚨If you don't see your stream show up in Community Streams channel, let **CharlieAKAN** know🚨`,
      ephemeral: true
    });
  }
};
