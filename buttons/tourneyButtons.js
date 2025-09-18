// buttons/tourneyButtons.js
const {
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { loadTournament, setPlayerFields, saveTournament } = require('../lib/store');
const { sendThreadDM } = require('../lib/threadDM');

const EPHEMERAL = (MessageFlags && MessageFlags.Ephemeral) ? MessageFlags.Ephemeral : 64;

// Wrapper so the rest of this file can "message the user" without DMs.
// Always pass the tid string to avoid undefined tid saves.
async function threadMsg(client, tid, userId, payload, fallbackChannelId = null, name = null) {
  const res = await sendThreadDM(client, tid, userId, payload, fallbackChannelId, name);
  return res.ok;
}

// -------------------- Payment flow --------------------
async function paidClick(interaction, tid, userId) {
  if (interaction.user.id !== userId) {
    return interaction.reply({ flags: EPHEMERAL, content: "This button isn't for you." });
  }
  setPlayerFields(tid, userId, { paymentStatus: 'pending' });

  const t = loadTournament(tid);
  if (!t) {
    return interaction.reply({ flags: EPHEMERAL, content: '❌ Tournament not found.' });
  }

  const embed = new EmbedBuilder()
    .setTitle(`Payment Review — ${t.meta?.name || tid}`)
    .setDescription(
      `<@${userId}> clicked **I Paid**.\nVerify payment.` +
      (t.payment?.note ? `\n${t.payment.note}` : '')
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mark_paid:${tid}:${userId}`).setLabel('✅ Mark Paid').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`mark_unpaid:${tid}:${userId}`).setLabel('❌ Not Yet').setStyle(ButtonStyle.Danger),
  );

  // Priority: .env → tourney meta → current channel
  const guild = interaction.client.guilds.cache.get(t.meta.guildId);
  const fromEnv = process.env.PAYMENT_REVIEW_CHANNEL_ID || null;
  const fromMeta = t.meta?.paymentReviewChannelId || t.meta?.channelId || null;

  let channel = null;
  try {
    if (guild && fromEnv) {
      channel = await guild.channels.fetch(fromEnv).catch(() => null);
    }
    if (!channel && guild && fromMeta) {
      channel = await guild.channels.fetch(fromMeta).catch(() => null);
    }
  } catch {}

  if (!channel) channel = interaction.channel;
  await channel.send({ embeds: [embed], components: [row] });

  // Drop a note into the user's private thread
  const payInfo = t.payment || {};
  await threadMsg(
    interaction.client,
    tid,
    userId,
    {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${t.meta?.name || tid} — Payment Received (Pending Review)`)
          .setDescription([
            `We got your **I Paid** click and will verify shortly.`,
            payInfo.note ? `\n${payInfo.note}` : null,
            payInfo.linkUrl ? `\nPayment link (for reference): ${payInfo.linkUrl}` : null
          ].filter(Boolean).join(''))
          .setTimestamp(new Date())
          .setImage(payInfo.qrCdnUrl || null)
      ]
    }
  );

  return interaction.reply({
    flags: EPHEMERAL,
    content: 'Thanks! Chickies will verify shortly.'
  });
}

async function markPaid(interaction, tid, userId) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ flags: EPHEMERAL, content: 'You need Manage Server to do that.' });
  }
  const t = loadTournament(tid);
  if (!t) return interaction.reply({ flags: EPHEMERAL, content: '❌ Tournament not found.' });

  setPlayerFields(tid, userId, { paymentStatus: 'verified', paid: true });
  await interaction.update({ content: `✅ Marked <@${userId}> as **paid** for \`${tid}\`.`, embeds: [], components: [] });

  // notify user in their private thread, with a mention + deck submit nudge
  await threadMsg(
    interaction.client,
    tid,
    userId,
    `✅ Payment verified for **${t.meta?.name || tid}**. See you in Round 1!\n\n<@${userId}>, you can now submit your deck for approval using command </tourney_deck_submit:1412563902386016440>`
  );
}

async function markUnpaid(interaction, tid, userId) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ flags: EPHEMERAL, content: 'You need Manage Server to do that.' });
  }
  const t = loadTournament(tid);
  if (!t) return interaction.reply({ flags: EPHEMERAL, content: '❌ Tournament not found.' });

  setPlayerFields(tid, userId, { paymentStatus: 'unpaid', paid: false });
  await interaction.update({ content: `❌ Marked <@${userId}> as **not paid** for \`${tid}\`.`, embeds: [], components: [] });

  await threadMsg(
    interaction.client,
    tid,
    userId,
    `❌ We couldn’t verify your payment for **${t.meta?.name || tid}**. If you paid, reply here with a receipt or contact Chickies.`
  );
}

// -------------------- Deck review flow --------------------
async function deckApprove(interaction, tid, userId) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ flags: EPHEMERAL, content: '🚫 You need Manage Server to approve decks.' });
  }
  const t = loadTournament(tid);
  if (!t) return interaction.reply({ flags: EPHEMERAL, content: '❌ Tournament not found.' });

  const p = t.players?.[userId];
  if (!p?.deck) return interaction.reply({ flags: EPHEMERAL, content: '❌ That player has no pending deck.' });

  p.deck.status = 'approved';
  p.deck.approvedAt = new Date().toISOString();
  p.deck.approvedBy = interaction.user.id;
  p.deck.locked = true;
  saveTournament(tid, t);

  await interaction.update({
    content: `✅ **Approved** deck for <@${userId}> in \`${tid}\`.`,
    embeds: [],
    components: []
  });

  const ok = await threadMsg(
    interaction.client,
    tid,
    userId,
    {
      embeds: [
        new EmbedBuilder()
          .setTitle('Deck Approved')
          .setDescription(`Your deck for **${t.meta?.name || tid}** has been **approved**.`)
          .addFields(
            ...(p.deck?.url ? [{ name: 'Link', value: p.deck.url }] : []),
            ...(p.deck?.text ? [{ name: 'Note', value: 'Your text list is on file.' }] : [])
          )
          .setTimestamp(new Date())
      ]
    }
  );

  const deckChannelId = process.env.DECKLIST_CHANNEL_ID || t.meta?.deckChannelId || null;
  if (deckChannelId) {
    try {
      const guild = interaction.client.guilds.cache.get(t.meta.guildId);
      const chan = guild ? await guild.channels.fetch(deckChannelId).catch(() => null) : null;
      if (chan) {
        const eb = new EmbedBuilder()
          .setTitle(`${t.meta?.name || tid} — Approved Deck`)
          .setDescription(`<@${userId}>`)
          .setTimestamp(new Date());
        if (p.deck.url) eb.addFields({ name: 'Link', value: p.deck.url });
        if (p.deck.text) {
          const preview = '```\n' + (p.deck.text.length > 1900 ? p.deck.text.slice(0, 1900) + '\n…' : p.deck.text) + '\n```';
          eb.addFields({ name: 'List', value: preview });
        }
        if (p.deck.fileUrl) eb.addFields({ name: 'File', value: p.deck.fileUrl });
        await chan.send({ embeds: [eb] });
      }
    } catch {}
  }

  if (!ok) {
    try {
      await interaction.followUp({
        flags: EPHEMERAL,
        content: `ℹ️ Couldn’t post to <@${userId}>'s thread.`
      });
    } catch {}
  }
}

async function deckReject(interaction, tid, userId) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ flags: EPHEMERAL, content: '🚫 You need Manage Server to reject decks.' });
  }
  const t = loadTournament(tid);
  if (!t) return interaction.reply({ flags: EPHEMERAL, content: '❌ Tournament not found.' });

  const p = t.players?.[userId];
  if (!p?.deck) return interaction.reply({ flags: EPHEMERAL, content: '❌ That player has no pending deck.' });

  p.deck.status = 'rejected';
  p.deck.rejectedAt = new Date().toISOString();
  p.deck.rejectedBy = interaction.user.id;
  p.deck.locked = false;
  saveTournament(tid, t);

  await interaction.update({
    content: `❌ **Rejected** deck for <@${userId}> in \`${tid}\`.`,
    embeds: [],
    components: []
  });

  const ok = await threadMsg(
    interaction.client,
    tid,
    userId,
    `❌ Your deck for **${t.meta?.name || tid}** was **rejected**.\nPlease review the event rules and resubmit. If you need help, contact a TO.`
  );
  if (!ok) {
    try {
      await interaction.followUp({
        flags: EPHEMERAL,
        content: `ℹ️ Couldn’t post to <@${userId}>'s thread.`
      });
    } catch {}
  }
}

// -------------------- Router --------------------
function handles(customId) {
  return (
    customId.startsWith('paid_click:')   ||
    customId.startsWith('mark_paid:')    ||
    customId.startsWith('mark_unpaid:')  ||
    customId.startsWith('deck_approve:') ||
    customId.startsWith('deck_reject:')
  );
}

async function route(interaction) {
  const [kind, tid, userId] = interaction.customId.split(':');
  if (kind === 'paid_click')    return paidClick(interaction, tid, userId);
  if (kind === 'mark_paid')     return markPaid(interaction, tid, userId);
  if (kind === 'mark_unpaid')   return markUnpaid(interaction, tid, userId);
  if (kind === 'deck_approve')  return deckApprove(interaction, tid, userId);
  if (kind === 'deck_reject')   return deckReject(interaction, tid, userId);
}

module.exports = { handles, route };
