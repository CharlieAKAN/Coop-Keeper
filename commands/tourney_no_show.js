// commands/tourney_no_show.js
const {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
} = require('discord.js');
const { loadTournament, saveTournament } = require('../lib/store');

const EPHEMERAL = (MessageFlags && MessageFlags.Ephemeral) ? MessageFlags.Ephemeral : 64;

module.exports.data = new SlashCommandBuilder()
  .setName('tourney_no_show')
  .setDescription('Report a player as a no-show (auto-drops them and awards the round to the opponent)')
  .addStringOption(o => o.setName('tid').setDescription('Tournament ID').setRequired(true))
  .addUserOption(o => o.setName('player').setDescription('The player who did not show').setRequired(true))
  .addBooleanOption(o => o.setName('confirm').setDescription('Confirm the no-show (required)').setRequired(false));

// Guild only
if (typeof module.exports.data.setContexts === 'function') {
  module.exports.data.setContexts(InteractionContextType.Guild);
} else {
  module.exports.data.setDMPermission(false);
}

module.exports.execute = async (interaction) => {
  const tid        = interaction.options.getString('tid', true);
  const noShowUser = interaction.options.getUser('player', true);
  const confirm    = interaction.options.getBoolean('confirm') ?? false;

  const t = loadTournament(tid);
  if (!t) return interaction.reply({ flags: EPHEMERAL, content: '❌ Tournament not found.' });

  if ((t.meta?.status || 'registration') !== 'in_progress') {
    return interaction.reply({ flags: EPHEMERAL, content: '⏳ The tournament is not currently in progress.' });
  }

  if (!confirm) {
    return interaction.reply({
      flags: EPHEMERAL,
      content: `⚠️ This will mark <@${noShowUser.id}> as a **no-show**, **drop** them, and **award** the round to their opponent.\nRe-run with **confirm: true** to proceed.`
    });
  }

  // Find current round and the no-show player’s active (unreported) match
  const roundNum = Number(t.meta?.currentRound || 0);
  const round = t.rounds?.[String(roundNum)];
  if (!round || !Array.isArray(round.pairings) || round.pairings.length === 0) {
    return interaction.reply({ flags: EPHEMERAL, content: `❌ No pairings found for Round ${roundNum}.` });
  }

  const uid = noShowUser.id;
  const match = round.pairings.find(m =>
    (!m.result || m.result === 'PENDING') && (m.playerA === uid || m.playerB === uid)
  );

  if (!match) {
    return interaction.reply({
      flags: EPHEMERAL,
      content: `❌ Couldn’t find an active unreported table this round for <@${uid}>.`
    });
  }
  if (match.bye) {
    return interaction.reply({
      flags: EPHEMERAL,
      content: `ⓘ <@${uid}> is seated at a BYE for Round ${roundNum}; no-show isn’t applicable.`
    });
  }

  // Determine opponent & winning side
  const iAmA = (match.playerA === uid);
  const winnerSide = iAmA ? 'B' : 'A';
  const winnerId   = iAmA ? match.playerB : match.playerA;
  const loserId    = uid;

  // Drop the no-show player
  const loser = t.players?.[loserId];
  if (!loser) {
    return interaction.reply({ flags: EPHEMERAL, content: '❌ Player record not found in this tournament.' });
  }
  loser.dropped = true;
  loser.droppedAt = new Date().toISOString();
  loser.dropReason = 'no_show';

  // Apply match result + scoring
  match.result = winnerSide;
  match.reportedBy = 'system:no_show';
  match.reportedAt = new Date().toISOString();
  match.noShow = true;

  const pWin = t.players?.[winnerId];
  if (!pWin) {
    return interaction.reply({ flags: EPHEMERAL, content: '❌ Opponent record missing — cannot award the round.' });
  }
  // init records
  pWin.record   = pWin.record   || { wins:0, losses:0, draws:0 };
  loser.record  = loser.record  || { wins:0, losses:0, draws:0 };
  pWin.score = (pWin.score || 0) + 3;
  pWin.record.wins += 1;
  loser.score = (loser.score || 0) + 0;
  loser.record.losses += 1;

  saveTournament(tid, t);

  // Build public announcement
  const publicMsg =
    `<@${uid}> didn’t show up to the table after **5 minutes** from round start. ` +
    `This is considered a **no-show**, and they have been **dropped** from the tournament.`;

  // Send to the wins channel (fallback to event channel)
  const winsChanId = process.env.TOURNEY_WIN_CHANNEL_ID || t.meta?.winChannelId || t.meta?.channelId;
  if (winsChanId) {
    try {
      const guild = interaction.client.guilds.cache.get(t.meta.guildId);
      const chan = guild ? await guild.channels.fetch(winsChanId).catch(() => null) : null;
      if (chan) await chan.send(publicMsg);
    } catch {}
  }

  // Also tell the channel where the command ran (non-ephemeral)
  try {
    await interaction.channel.send(publicMsg);
  } catch {}

  // Ephemeral confirmation to reporter
  return interaction.reply({
    flags: EPHEMERAL,
    content: `✅ Marked <@${uid}> as **no-show** and awarded the round to <@${winnerId}>.`
  });
};
