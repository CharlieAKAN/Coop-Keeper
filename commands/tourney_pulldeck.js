// commands/tourney_pulldeck.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags
} = require('discord.js');
const { loadTournament } = require('../lib/store');
const { requireAdmin } = require('../lib/auth');

const EPHEMERAL = (MessageFlags && MessageFlags.Ephemeral) ? MessageFlags.Ephemeral : 64;

module.exports.data = new SlashCommandBuilder()
  .setName('tourney_pulldeck')
  .setDescription('View a player’s submitted deck (admin)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o => o.setName('tid').setDescription('Tournament ID').setRequired(true))
  .addUserOption(o => o.setName('player').setDescription('Player to fetch').setRequired(true))
  .addBooleanOption(o => o.setName('public').setDescription('Post publicly (default: no)').setRequired(false));

if (typeof module.exports.data.setContexts === 'function') {
  module.exports.data.setContexts(InteractionContextType.Guild);
} else {
  module.exports.data.setDMPermission(false);
}

module.exports.execute = async (interaction) => {
  if (!(await requireAdmin(interaction))) return;

  const tid     = interaction.options.getString('tid', true);
  const user    = interaction.options.getUser('player', true);
  const isPublic = interaction.options.getBoolean('public') ?? false;

  const t = loadTournament(tid);
  if (!t) {
    return interaction.reply({ flags: EPHEMERAL, content: '❌ Tournament not found.' });
  }

  const p = t.players?.[user.id];
  if (!p) {
    return interaction.reply({ flags: EPHEMERAL, content: `❌ That user is not registered in \`${tid}\`.` });
  }

  const d = p.deck || null;
  if (!d || (!d.url && !d.fileUrl && !d.text)) {
    return interaction.reply({ flags: isPublic ? undefined : EPHEMERAL, content: `ⓘ No deck on file for <@${user.id}>.` });
  }

  const status = d.status || (d.locked ? 'locked' : 'unreviewed');
  const legal  = (d.legal === true) ? 'Yes' : (d.legal === false ? 'No' : 'Unknown');

  const eb = new EmbedBuilder()
    .setTitle(`${t.meta?.name || tid} — Deck on File`)
    .setDescription(`Player: <@${user.id}>`)
    .setFooter({ text: `Status: ${status} • Legal: ${legal}${d.locked ? ' • Locked' : ''}` })
    .setTimestamp(new Date());

  if (d.url)     eb.addFields({ name: 'Link', value: d.url });
  if (d.fileUrl) eb.addFields({ name: 'File', value: d.fileUrl });

  // Parsed summary (if available)
  const total = d.parsed?.total ?? null;
  const invalidCnt = Array.isArray(d.parsed?.invalid) ? d.parsed.invalid.length : null;
  const summaryBits = [];
  if (total !== null) summaryBits.push(`Cards parsed: **${total}**`);
  if (invalidCnt !== null) summaryBits.push(`Unparsed lines: **${invalidCnt}**`);
  if (summaryBits.length) eb.addFields({ name: 'Summary', value: summaryBits.join(' • ') });

  // Text preview or attachment
  const files = [];
  if (d.text) {
    const preview = d.text.length > 900 ? d.text.slice(0, 900) + '\n…' : d.text;
    eb.addFields({ name: 'Text Preview', value: '```\n' + preview + '\n```' });

    if (d.text.length > 1500) {
      const payload = `Player: ${p.displayName || user.tag} (${user.id})\nTournament: ${t.meta?.name || tid}\n\n${d.text}`;
      const buffer = Buffer.from(payload, 'utf8');
      files.push(new AttachmentBuilder(buffer, { name: `deck_${tid}_${user.id}.txt` }));
    }
  }

  const payload = { embeds: [eb], files };
  if (isPublic) {
    return interaction.reply(payload);
  } else {
    return interaction.reply({ ...payload, flags: EPHEMERAL });
  }
};
