const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { loadTournament, addOrUpdatePlayer, setPlayerFields } = require('../lib/store');
const { sendThreadDM } = require('../lib/threadDM');

const EPHEMERAL = (MessageFlags && MessageFlags.Ephemeral) ? MessageFlags.Ephemeral : 64;

module.exports.data = new SlashCommandBuilder()
  .setName('tourney_register')
  .setDescription('Register for a tournament')
  .addStringOption(o=>o.setName('tid').setDescription('Tournament ID').setRequired(true));

module.exports.execute = async (interaction) => {
  const tid = interaction.options.getString('tid', true);
  const t = loadTournament(tid);
  if (!t) return interaction.reply({ flags: EPHEMERAL, content:'❌ Tournament not found.' });
  if ((t.meta.status || 'registration') !== 'registration') {
    return interaction.reply({ flags: EPHEMERAL, content:'🚫 Registration is closed.' });
  }

  // Create / update player
  addOrUpdatePlayer(tid, interaction.user);

  // Payment is required by default unless explicitly false
  const paymentRequired = (t.meta?.paidRequired !== false);

  if (paymentRequired) {
    // Force unpaid on register
    setPlayerFields(tid, interaction.user.id, { paymentStatus: 'unpaid', paid: false });

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
      new ButtonBuilder()
        .setCustomId(`paid_click:${tid}:${interaction.user.id}`)
        .setLabel('I Paid')
        .setStyle(ButtonStyle.Success)
    );

    // IMPORTANT: pass the tid string (not the object) so saving can't blow up
    const th = await sendThreadDM(
      interaction.client,
      tid,
      interaction.user.id,
      { embeds: [embed], components: [row] }
    );

    if (th.ok) {
      return interaction.reply({ flags: EPHEMERAL, content:'🧾 I opened a private thread for you with the payment info (QR/link).' });
    } else {
      const reason = th.reason || 'unknown_error';
      return interaction.reply({
        flags: EPHEMERAL,
        content:`⚠️ I couldn’t create your private thread (reason: \`${reason}\`). Showing payment here instead.`,
        embeds:[embed],
        components:[row]
      });
    }
  }

  // No payment required
  setPlayerFields(tid, interaction.user.id, { paymentStatus: 'verified', paid: false });
  return interaction.reply({ flags: EPHEMERAL, content:`✅ Registered for **${t.meta.name || tid}**.` });
};
