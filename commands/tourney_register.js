const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { loadTournament, addOrUpdatePlayer, setPlayerFields } = require('../lib/store');

module.exports.data = new SlashCommandBuilder()
  .setName('tourney_register')
  .setDescription('Register for a tournament')
  .addStringOption(o=>o.setName('tid').setDescription('Tournament ID').setRequired(true));

module.exports.execute = async (interaction) => {
  const tid = interaction.options.getString('tid', true);
  const t = loadTournament(tid);
  if (!t) return interaction.reply({ephemeral:true, content:'❌ Tournament not found.'});
  if ((t.meta.status || 'registration') !== 'registration') return interaction.reply({ephemeral:true, content:'🚫 Registration is closed.'});

  addOrUpdatePlayer(tid, interaction.user);

  if (!t.meta.paidRequired) {
    setPlayerFields(tid, interaction.user.id, { paymentStatus: 'verified', paid: false });
    return interaction.reply({ephemeral:true, content:`✅ Registered for **${t.meta.name || tid}**.`});
  }

  const pay = t.payment || {};
  const embed = new EmbedBuilder()
    .setTitle(`${t.meta.name || tid} — Entry Fee`)
    .setDescription([
      pay.note || '📝 Include your Discord name in the payment notes.',
      pay.linkUrl ? `**Payment link:** ${pay.linkUrl}` : null,
      'When you’ve paid, click **I Paid** below.'
    ].filter(Boolean).join('\n'));
  if (pay.qrCdnUrl) embed.setImage(pay.qrCdnUrl);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`paid_click:${tid}:${interaction.user.id}`).setLabel('I Paid').setStyle(ButtonStyle.Success)
  );

  try {
    await interaction.user.send({ embeds: [embed], components: [row] });
    await interaction.reply({ephemeral:true, content:'🧾 I DM’d you the payment info (QR/link).'});
  } catch {
    await interaction.reply({ ephemeral: true, embeds: [embed], components: [row] });
  }
};
