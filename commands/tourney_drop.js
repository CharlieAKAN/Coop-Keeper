// commands/tourney_drop.js
const {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags
} = require('discord.js');
const { loadTournament, saveTournament } = require('../lib/store');

const EPHEMERAL = (MessageFlags && MessageFlags.Ephemeral) ? MessageFlags.Ephemeral : 64;

module.exports.data = new SlashCommandBuilder()
  .setName('tourney_drop')
  .setDescription('Drop yourself from the tournament')
  .addStringOption(o => o.setName('tid').setDescription('Tournament ID').setRequired(true))
  .addStringOption(o => o.setName('reason').setDescription('Optional reason (DMs are fine too)').setRequired(false))
  .addBooleanOption(o => o.setName('confirm').setDescription('Really drop?').setRequired(false));

// Guild only
if (typeof module.exports.data.setContexts === 'function') {
  module.exports.data.setContexts(InteractionContextType.Guild);
} else {
  module.exports.data.setDMPermission(false);
}

async function sendToWinChannel(interaction, t, content) {
  const winChannelId = process.env.TOURNEY_WIN_CHANNEL_ID || t.meta?.winChannelId || t.meta?.channelId;
  if (!winChannelId) return false;
  try {
    const guild = interaction.client.guilds.cache.get(t.meta.guildId);
    const chan = guild ? await guild.channels.fetch(winChannelId).catch(() => null) : null;
    if (!chan) return false;
    await chan.send(content);
    return true;
  } catch {
    return false;
  }
}

module.exports.execute = async (interaction) => {
  const tid       = interaction.options.getString('tid', true);
  const reason    = interaction.options.getString('reason') ?? null;
  const confirmed = interaction.options.getBoolean('confirm') ?? false;

  const t = loadTournament(tid);
  if (!t) return interaction.reply({ flags: EPHEMERAL, content: '❌ Tournament not found.' });

  const userId = interaction.user.id;
  const p = t.players?.[userId];
  if (!p) {
    return interaction.reply({ flags: EPHEMERAL, content: '❌ You are not registered in this event.' });
  }

  if (!confirmed) {
    return interaction.reply({
      flags: EPHEMERAL,
      content: '⚠️ This will drop you from the tournament and (if you have an active unreported match) award the round to your opponent.\nRe-run with **confirm: true** to proceed.'
    });
  }

  // Already dropped?
  if (p.dropped) {
    return interaction.reply({ flags: EPHEMERAL, content: 'ⓘ You are already dropped from this tournament.' });
  }

  // Mark dropped
  p.dropped = true;
  p.droppedAt = new Date().toISOString();
  if (reason) p.dropReason = reason;

  let autoAwardMsg = null;

  // If tournament running, try to find an active pairing this round and auto-award
  if ((t.meta?.status || 'registration') === 'in_progress') {
    const roundNum = Number(t.meta?.currentRound || 0);
    const round = t.rounds?.[String(roundNum)];
    if (round && Array.isArray(round.pairings)) {
      const m = round.pairings.find(pp =>
        (!pp.result || pp.result === 'PENDING') &&
        (pp.playerA === userId || pp.playerB === userId)
      );

      if (m && !m.bye) {
        const now = new Date().toISOString();
        const iAmA = (m.playerA === userId);
        const winnerSide = iAmA ? 'B' : 'A';
        const winnerId   = iAmA ? m.playerB : m.playerA;
        const loserId    = userId;

        m.result = winnerSide;
        m.reportedBy = 'system:drop';
        m.reportedAt = now;
        m.dropConcession = true;

        // Update scores/records
        const pWin = t.players?.[winnerId];
        const pLose= t.players?.[loserId];
        if (pWin && pLose) {
          pWin.record = pWin.record || { wins:0, losses:0, draws:0 };
          pLose.record= pLose.record|| { wins:0, losses:0, draws:0 };
          pWin.score = (pWin.score || 0) + 3;
          pWin.record.wins += 1;
          pLose.score = (pLose.score || 0) + 0;
          pLose.record.losses += 1;
        }

        autoAwardMsg = `Auto-awarded **Table ${m.table}** to <@${winnerId}> due to drop.`;
      }
    }
  }

  saveTournament(tid, t);

  // Public notice -> TOURNEY_WIN_CHANNEL_ID (fallback to event channel if not set/fetchable)
  const publicMsg = `<@${userId}> has **dropped** from ${t.meta?.name || tid}.` + (autoAwardMsg ? ` ${autoAwardMsg}` : '');
  const posted = await sendToWinChannel(interaction, t, publicMsg);
  if (!posted) {
    try {
      const guild = interaction.client.guilds.cache.get(t.meta.guildId);
      const fallback = guild?.channels?.cache.get(t.meta.channelId);
      if (fallback) await fallback.send(publicMsg);
    } catch {}
  }

  // Ephemeral confirm to the player
  return interaction.reply({
    flags: EPHEMERAL,
    content: `✅ You have been dropped from **${t.meta?.name || tid}**.` +
             (autoAwardMsg ? `\n${autoAwardMsg}` : '') +
             (reason ? `\nReason noted: ${reason}` : '')
  });
};
