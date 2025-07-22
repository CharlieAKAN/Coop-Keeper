// commands/coop_level.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLevel, getXP } = require('./levelSystem');

// Build a progress bar like: █████░░░░░░░░░░
function progressBar(current, max, length = 20) {
  if (max <= 0) return '░'.repeat(length);
  const filledLen = Math.round((current / max) * length);
  return '█'.repeat(filledLen) + '░'.repeat(length - filledLen);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coop_level')
    .setDescription('Show your current Coop Level, XP and progress.'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const avatar = interaction.user.displayAvatarURL();

    const xp = getXP(userId);
    const lvl = getLevel(userId);

    // Get level breakpoints from env or fallback
    const breaks = process.env.LEVEL_BREAKS
      ? process.env.LEVEL_BREAKS.split(',').map(n => parseInt(n.trim()))
      : [0, 50, 125, 250, 500, 800, 1200];

    const nextXP = (lvl + 1 < breaks.length) ? breaks[lvl + 1] : null;
    const prevXP = breaks[lvl];
    const barProgress = nextXP ? progressBar(xp - prevXP, nextXP - prevXP) : '';

    // Build a sexy embed
    const embed = new EmbedBuilder()
      .setColor(0x1abc9c)
      .setAuthor({ name: username, iconURL: avatar })
      .setTitle(`🔰 Coop Level ${lvl}`)
      .setDescription(nextXP
        ? `XP: **${xp} / ${nextXP}**\n${barProgress}`
        : `XP: **${xp}**\n🏆 Max level reached!`)
      .setFooter({ text: nextXP ? `${nextXP - xp} XP to next level` : 'You’re at the top!' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
