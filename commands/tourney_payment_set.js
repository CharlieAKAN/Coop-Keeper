const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const { upsertPayment, upsertTournament } = require('../lib/store');
const { requireAdmin } = require('../lib/auth');

const builder = new SlashCommandBuilder()
  .setName('tourney_payment_set')
  .setDescription('Set payment QR/link + note (file-based)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(o=>o.setName('tid').setDescription('Tournament ID').setRequired(true))
  .addStringOption(o=>o.setName('mode').setDescription('link | qr | both').setRequired(true)
    .addChoices({name:'link',value:'link'},{name:'qr',value:'qr'},{name:'both',value:'both'}))
  .addStringOption(o=>o.setName('link').setDescription('Payment link (Venmo/CashApp/PayPal)').setRequired(false))
  .addAttachmentOption(o=>o.setName('qr_image').setDescription('QR code image').setRequired(false))
  .addStringOption(o=>o.setName('note').setDescription('Defaults to Discord-name reminder').setRequired(false));

if (typeof builder.setContexts === 'function') builder.setContexts(InteractionContextType.Guild);
else builder.setDMPermission(false);

module.exports.data = builder;

module.exports.execute = async (interaction) => {
  if (!(await requireAdmin(interaction))) return;

  const tid = interaction.options.getString('tid', true);
  const mode = interaction.options.getString('mode', true);
  const linkUrl = interaction.options.getString('link') ?? null;
  const qr = interaction.options.getAttachment('qr_image') ?? null;
  const noteInput = interaction.options.getString('note') ?? null;

  if (mode === 'link' && !linkUrl) return interaction.reply({ephemeral:true, content:'Provide a link for link mode.'});
  if (mode === 'qr' && !qr) return interaction.reply({ephemeral:true, content:'Upload a QR image for qr mode.'});
  if (mode === 'both' && !linkUrl && !qr) return interaction.reply({ephemeral:true, content:'Provide link and/or QR.'});

  const note = noteInput || '📝 IMPORTANT: Include your Discord username (e.g., @CharChar) in the payment notes.';

  upsertTournament({ tid, guildId: interaction.guildId, channelId: interaction.channelId });
  upsertPayment(tid, { mode, linkUrl, qrCdnUrl: qr?.url ?? null, note });

  return interaction.reply({ ephemeral:true, content:'✅ Payment info saved.' });
};
