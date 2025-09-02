const { PermissionFlagsBits } = require('discord.js');

function isAdmin(interaction) {
  return interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
}

async function requireAdmin(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({ ephemeral: true, content: '❌ This command only works in a server!' });
    return false;
  }
  if (!isAdmin(interaction)) {
    await interaction.reply({ ephemeral: true, content: '🚫 Admins only.' });
    return false;
  }
  return true;
}

module.exports = { isAdmin, requireAdmin };
