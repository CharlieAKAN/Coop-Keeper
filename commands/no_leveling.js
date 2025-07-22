const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'optOut.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('no_leveling')
    .setDescription('Opt out of XP and leveling messages.'),

  async execute(interaction) {
    const userId = interaction.user.id;
    let store = {};

    try {
      store = fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, 'utf8'))
        : {};
    } catch (e) {
      console.error('Failed to read opt-out file:', e);
    }

    if (store[userId]) {
      await interaction.reply({ content: 'You already opted out of leveling.', ephemeral: true });
    } else {
      store[userId] = true;
      fs.writeFileSync(file, JSON.stringify(store, null, 2));
      await interaction.reply({ content: '✅ You will no longer gain XP or get level notifications.', ephemeral: true });
    }
  }
};
