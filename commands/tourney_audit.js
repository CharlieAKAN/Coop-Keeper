// commands/tourney_audit.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { loadTournament } = require('../lib/store');

const EPHEMERAL = (MessageFlags && MessageFlags.Ephemeral) ? MessageFlags.Ephemeral : 64;

// -- helpers ---------------------------------------------------------------
function chunkIntoFields(title, lines, maxFieldLen = 1024) {
  // Returns an array of { name, value, inline:false } for embed fields
  if (!lines.length) return [];
  const fields = [];
  let bucket = [];
  let curLen = 0;
  let part = 1;

  const pushField = () => {
    if (!bucket.length) return;
    fields.push({
      name: fields.length === 0 ? title : `${title} (cont. ${part++})`,
      value: bucket.join('\n'),
      inline: false
    });
    bucket = [];
    curLen = 0;
  };

  for (const line of lines) {
    const addLen = line.length + 1; // +1 for newline
    if (curLen + addLen > maxFieldLen) {
      pushField();
    }
    bucket.push(line);
    curLen += addLen;
  }
  pushField();
  return fields;
}

function withTruncation(lines, limit) {
  if (lines.length <= limit) return { shown: lines, more: 0 };
  return { shown: lines.slice(0, limit), more: lines.length - limit };
}

module.exports.data = new SlashCommandBuilder()
  .setName('tourney_audit')
  .setDescription('Admin: overview of payment + deck submissions')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o => o.setName('tid').setDescription('Tournament ID').setRequired(true))
  .addBooleanOption(o => o.setName('public').setDescription('Post publicly (default: false)').setRequired(false));

if (typeof module.exports.data.setContexts === 'function') {
  module.exports.data.setContexts(InteractionContextType.Guild);
} else {
  module.exports.data.setDMPermission(false);
}

module.exports.execute = async (interaction) => {
  const tid = interaction.options.getString('tid', true);
  const isPublic = interaction.options.getBoolean('public') ?? false;

  const t = loadTournament(tid);
  if (!t) {
    return interaction.reply({ flags: EPHEMERAL, content: '❌ Tournament not found.' });
  }

  const players = Object.values(t.players || {});
  if (players.length === 0) {
    return interaction.reply({ flags: EPHEMERAL, content: 'ⓘ No registered players.' });
  }

  const rows = players.map(p => {
    const deck = p.deck || {};
    const deckSubmitted =
      Boolean(deck.text && deck.text.trim().length) ||
      Boolean(deck.url) ||
      Boolean(deck.fileUrl);

    const deckStatus = deck.status || (deckSubmitted ? 'pending' : 'none');
    const paymentStatus = p.paymentStatus || 'unpaid';
    const paidVerified = paymentStatus === 'verified';

    return {
      id: p.userId,
      mention: `<@${p.userId}>`,
      name: p.displayName || p.userId,
      dropped: !!p.dropped,
      paid: !!p.paid,
      paymentStatus,
      paidVerified,
      deckSubmitted,
      deckStatus,
      deckLocked: !!deck.locked,
      deckCards: typeof deck.parsed?.total === 'number' ? deck.parsed.total : null,
      deckApprovedBy: deck.approvedBy || '',
      deckApprovedAt: deck.approvedAt || '',
    };
  });

  // --- Grouping (priority & display) ---------------------------------------
  const bothMissing      = rows.filter(r => !r.paidVerified && !r.deckSubmitted);
  const paidOnlyMissing  = rows.filter(r =>  r.paidVerified && !r.deckSubmitted);
  const submitOnly       = rows.filter(r => !r.paidVerified &&  r.deckSubmitted);
  const allGood          = rows.filter(r =>  r.paidVerified &&  r.deckSubmitted);

  // Stable sort inside each group by name
  const byName = (a, b) => a.name.localeCompare(b.name);
  bothMissing.sort(byName);
  paidOnlyMissing.sort(byName);
  submitOnly.sort(byName);
  // For "all good" you can optionally prefer approved first:
  allGood.sort((a, b) => {
    const rank = s => (s === 'approved' ? 2 : s === 'pending' ? 1 : 0);
    const d = rank(b.deckStatus) - rank(a.deckStatus);
    return d || byName(a, b);
  });

  // --- Counts for header ----------------------------------------------------
  const total          = rows.length;
  const paidV          = rows.filter(r => r.paidVerified).length;
  const paidPend       = rows.filter(r => r.paymentStatus === 'pending').length;
  const unpaid         = rows.filter(r => !r.paidVerified && r.paymentStatus !== 'pending').length;

  const deckSub        = rows.filter(r => r.deckSubmitted).length;
  const deckApproved   = rows.filter(r => r.deckStatus === 'approved').length;
  const deckPending    = rows.filter(r => r.deckStatus === 'pending').length;
  const deckRejected   = rows.filter(r => r.deckStatus === 'rejected').length;

  // --- Line builders (compact to avoid embed length issues) -----------------
  const lineMissingBoth = bothMissing.map(r =>
    `• ${r.mention} (${r.name}) — pay: **${r.paymentStatus}**, deck: **none**`
  );
  const linePaidMissing = paidOnlyMissing.map(r =>
    `• ${r.mention} (${r.name}) — deck: **none**`
  );
  const lineSubmitOnly = submitOnly.map(r =>
    `• ${r.mention} (${r.name}) — pay: **${r.paymentStatus}**, deck: **${r.deckStatus}**`
  );
  const lineAllGood = allGood.map(r =>
    `• ${r.mention} (${r.name}) — ✅ verified, deck: **${r.deckStatus}**${r.deckLocked ? ' (locked)' : ''}`
  );

  // Hard caps per group to avoid 6000-char embed limit; CSV still has all data
  const CAP = 100; // safety; each field chunk will further split to 1024 chars
  const mb = withTruncation(lineMissingBoth, CAP);
  const pm = withTruncation(linePaidMissing, CAP);
  const so = withTruncation(lineSubmitOnly, CAP);
  const ag = withTruncation(lineAllGood, CAP);

  const fields = [
    ...chunkIntoFields(`❗ Missing Both — ${bothMissing.length}`, mb.shown),
    ...(mb.more ? [{ name: '…', value: `…and **${mb.more}** more`, inline: false }] : []),

    ...chunkIntoFields(`✅ Paid, Missing Deck — ${paidOnlyMissing.length}`, pm.shown),
    ...(pm.more ? [{ name: '…', value: `…and **${pm.more}** more`, inline: false }] : []),

    ...chunkIntoFields(`📝 Deck Submitted, Not Paid — ${submitOnly.length}`, so.shown),
    ...(so.more ? [{ name: '…', value: `…and **${so.more}** more`, inline: false }] : []),

    ...chunkIntoFields(`🎉 All Good — ${allGood.length}`, ag.shown),
    ...(ag.more ? [{ name: '…', value: `…and **${ag.more}** more`, inline: false }] : []),
  ].slice(0, 25); // Discord max 25 fields

  const embed = new EmbedBuilder()
    .setTitle(`${t.meta?.name || tid} — Audit (Payment + Decks)`)
    .setColor(0x5865F2)
    .setDescription(
      [
        `**Players:** ${total}`,
        `**Payment:** ✅ verified ${paidV} | ⏳ pending ${paidPend} | ❌ unpaid ${unpaid}`,
        `**Decks:** 📝 submitted ${deckSub} | ✅ approved ${deckApproved} | ⏳ pending ${deckPending} | ❌ rejected ${deckRejected}`,
      ].join('\n')
    )
    .addFields(fields)
    .setTimestamp(new Date());

  // CSV (full detail)
  const headers = [
    'player_id','player','dropped',
    'paid_verified','payment_status',
    'deck_submitted','deck_status','deck_locked','deck_cards',
    'deck_approved_by','deck_approved_at'
  ];
  const csvLines = [headers.join(',')];
  for (const r of [...bothMissing, ...paidOnlyMissing, ...submitOnly, ...allGood]) {
    const vals = [
      r.id,
      `"${String(r.name).replace(/"/g,'""')}"`,
      r.dropped ? 1 : 0,
      r.paidVerified ? 1 : 0,
      r.paymentStatus,
      r.deckSubmitted ? 1 : 0,
      r.deckStatus,
      r.deckLocked ? 1 : 0,
      r.deckCards ?? '',
      r.deckApprovedBy,
      r.deckApprovedAt
    ];
    csvLines.push(vals.join(','));
  }
  const csvBuf = Buffer.from(csvLines.join('\n'), 'utf8');
  const csv = new AttachmentBuilder(csvBuf, { name: `audit_${tid}.csv` });

  const payload = { embeds: [embed], files: [csv] };
  if (isPublic) {
    return interaction.reply(payload);
  } else {
    return interaction.reply({ ...payload, flags: EPHEMERAL });
  }
};
