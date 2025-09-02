// commands/tourney_report.js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { loadTournament, saveTournament } = require('../lib/store');
const { cancelRoundTimers } = require('../lib/roundTimers'); // ⬅️ NEW

const EPHEMERAL = (MessageFlags && MessageFlags.Ephemeral) ? MessageFlags.Ephemeral : 64;

module.exports.data = new SlashCommandBuilder()
  .setName('tourney_report')
  .setDescription('Report your result (simple: I won / Opponent won / Draw)')
  .addStringOption(o=>o.setName('tid').setDescription('Tournament ID').setRequired(true))
  .addStringOption(o=>o.setName('outcome').setDescription('Who won?').setRequired(true)
    .addChoices(
      { name: 'I won',        value: 'me' },
      { name: 'Opponent won', value: 'opponent' },
      { name: 'Draw',         value: 'draw' },
    ))
  .addIntegerOption(o=>o.setName('table').setDescription('Table number (optional)').setRequired(false).setMinValue(1));

// --- helpers ---
async function sendToChannel(client, guildId, channelId, content) {
  if (!channelId) return false;
  try {
    const guild = client.guilds.cache.get(guildId);
    const chan = guild ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (!chan) return false;
    await chan.send(content);
    return true;
  } catch {
    return false;
  }
}

function roundPendingCount(round) {
  if (!round || !Array.isArray(round.pairings)) return 0;
  return round.pairings.filter(m => !m.result || m.result === 'PENDING').length;
}

module.exports.execute = async (interaction) => {
  const tid     = interaction.options.getString('tid', true);
  const outcome = interaction.options.getString('outcome', true); // 'me' | 'opponent' | 'draw'
  const tableIn = interaction.options.getInteger('table') ?? null;

  let t = loadTournament(tid);
  if (!t) return interaction.reply({ flags: EPHEMERAL, content: '❌ Tournament not found.' });
  if ((t.meta?.status || 'registration') !== 'in_progress') {
    return interaction.reply({ flags: EPHEMERAL, content: '⏳ The tournament is not currently in progress.' });
  }

  const roundsObj = t.rounds || {};
  const roundNum = t.meta?.currentRound ?? Number(Object.keys(roundsObj).sort((a,b)=>a-b).pop() || 0);
  if (!roundNum) {
    return interaction.reply({ flags: EPHEMERAL, content: '❌ No active round. TOs: run /tourney_start or /tourney_next.' });
  }
  const round = roundsObj[String(roundNum)];
  if (!round || !Array.isArray(round.pairings) || round.pairings.length === 0) {
    return interaction.reply({ flags: EPHEMERAL, content: `❌ No pairings found for Round ${roundNum}. TOs: (re)run /tourney_start or /tourney_next.` });
  }

  const me = interaction.user.id;

  // Locate the reporter’s table
  let match = null;

  if (tableIn) {
    match = round.pairings.find(p => p.table === tableIn) || null;
    if (!match) {
      return interaction.reply({ flags: EPHEMERAL, content: `❌ Table ${tableIn} not found for Round ${roundNum}.` });
    }
    if (match.playerA !== me && match.playerB !== me && !match.bye) {
      return interaction.reply({ flags: EPHEMERAL, content: '🚫 Only players at this table can report the result.' });
    }
  } else {
    // Auto-find the reporter’s pending table in this round
    const seated = round.pairings.filter(p =>
      (p.playerA === me || p.playerB === me || p.bye) && (!p.result || p.result === 'PENDING')
    );
    if (seated.length === 0) {
      return interaction.reply({ flags: EPHEMERAL, content: '❌ Couldn’t find your active table this round (or it was already reported). Try adding the table number.' });
    }
    if (seated.length > 1) {
      const tables = seated.map(p => p.table).join(', ');
      return interaction.reply({ flags: EPHEMERAL, content: `⚠️ You’re seated at multiple tables? (tables ${tables}). Please rerun with the **table** option.` });
    }
    match = seated[0];
  }

  // BYE: enforce A wins
  if (match.bye) {
    if (match.result && match.result !== 'PENDING') {
      return interaction.reply({ flags: EPHEMERAL, content: `ⓘ Table ${match.table} (BYE) already recorded.` });
    }
    match.result = 'A';
    match.reportedBy = me;
    match.reportedAt = new Date().toISOString();
    const pA = t.players?.[match.playerA];
    if (pA) {
      pA.score = (pA.score || 0) + 3;
      pA.record = pA.record || { wins:0, losses:0, draws:0 };
      pA.record.wins += 1;
    }
    saveTournament(tid, t);

    const msg = `✅ BYE enforced at **Table ${match.table}** — <@${match.playerA}> wins.`;

    // ---- single-post logic (no duplicates) ----
    const winChanId = process.env.TOURNEY_WIN_CHANNEL_ID || t.meta?.winChannelId || t.meta?.channelId;
    let replied = false;
    if (winChanId) {
      try {
        const guild = interaction.client.guilds.cache.get(t.meta.guildId);
        const chan = guild ? await guild.channels.fetch(winChanId).catch(() => null) : null;
        if (chan) {
          if (chan.id === interaction.channelId) {
            await interaction.reply({ content: msg });
            replied = true;
          } else {
            await chan.send(msg);
            await interaction.reply({ flags: EPHEMERAL, content: '✅ Result posted.' });
            replied = true;
          }
        }
      } catch {}
    }
    if (!replied) await interaction.reply({ content: msg });

    // ⬇️ NEW: auto-end check after BYE record
    await maybeEndRoundEarly(interaction.client, tid, roundNum);

    return;
  }

  // Only seated players can report
  if (me !== match.playerA && me !== match.playerB) {
    return interaction.reply({ flags: EPHEMERAL, content: '🚫 Only players at this table can report the result.' });
  }

  // If already reported, don’t double-record
  if (match.result && match.result !== 'PENDING') {
    return interaction.reply({ flags: EPHEMERAL, content: 'ⓘ That table result is already recorded.' });
  }

  // Compute result 'A' | 'B' | 'D'
  let result;
  if (outcome === 'draw') {
    result = 'D';
  } else if (outcome === 'me') {
    result = (me === match.playerA) ? 'A' : 'B';
  } else if (outcome === 'opponent') {
    result = (me === match.playerA) ? 'B' : 'A';
  } else {
    return interaction.reply({ flags: EPHEMERAL, content: '❌ Invalid outcome.' });
  }

  // Apply result + scoring
  match.result = result;
  match.reportedBy = me;
  match.reportedAt = new Date().toISOString();

  const pA = t.players?.[match.playerA];
  const pB = t.players?.[match.playerB];
  if (!pA || !pB) {
    return interaction.reply({ flags: EPHEMERAL, content: '❌ Internal error: player references missing for that table.' });
  }
  pA.record = pA.record || { wins:0, losses:0, draws:0 };
  pB.record = pB.record || { wins:0, losses:0, draws:0 };

  if (result === 'A') {
    pA.score = (pA.score || 0) + 3; pA.record.wins += 1;
    pB.score = (pB.score || 0) + 0; pB.record.losses += 1;
  } else if (result === 'B') {
    pB.score = (pB.score || 0) + 3; pB.record.wins += 1;
    pA.score = (pA.score || 0) + 0; pA.record.losses += 1;
  } else {
    pA.score = (pA.score || 0) + 1; pB.score = (pB.score || 0) + 1;
    pA.record.draws += 1; pB.record.draws += 1;
  }

  saveTournament(tid, t);

  const msg =
    result === 'A' ? `✅ **Table ${match.table}** — <@${match.playerA}> wins.` :
    result === 'B' ? `✅ **Table ${match.table}** — <@${match.playerB}> wins.` :
                     `✅ **Table ${match.table}** — Draw reported.`;

  // ---- single-post logic (no duplicates) ----
  const winChanId = process.env.TOURNEY_WIN_CHANNEL_ID || t.meta?.winChannelId || t.meta?.channelId;
  let replied = false;
  if (winChanId) {
    try {
      const guild = interaction.client.guilds.cache.get(t.meta.guildId);
      const chan = guild ? await guild.channels.fetch(winChanId).catch(() => null) : null;
      if (chan) {
        if (chan.id === interaction.channelId) {
          await interaction.reply({ content: msg });
          replied = true;
        } else {
          await chan.send(msg);
          await interaction.reply({ flags: EPHEMERAL, content: '✅ Result posted.' });
          replied = true;
        }
      }
    } catch (err) {
      console.warn(`[tourney_report] Failed to send to win channel:`, err);
    }
  }
  if (!replied) await interaction.reply({ content: msg });

  // ⬇️ NEW: auto-end check after normal record
  await maybeEndRoundEarly(interaction.client, tid, roundNum);
};

// ⬇️ NEW helper at bottom of file
async function maybeEndRoundEarly(client, tid, roundNum) {
  // Reload fresh to avoid races
  const tNow = loadTournament(tid);
  const roundNow = tNow?.rounds?.[String(roundNum)];
  if (!roundNow) return;

  const remaining = roundPendingCount(roundNow);
  if (remaining > 0) return;

  // Mark schedule ended
  tNow.meta = tNow.meta || {};
  tNow.meta.roundSchedule = {
    ...(tNow.meta.roundSchedule || {}),
    round: roundNum,
    endedAt: new Date().toISOString()
  };
  saveTournament(tid, tNow);

  // Cancel any scheduled announcements for this round
  try {
    await cancelRoundTimers({ tid, round: roundNum });
  } catch (e) {
    // non-fatal
  }

  // Announce completion in the announce channel
  const announceChanId =
    process.env.TOURNEY_ANNOUNCE_CHANNEL_ID ||
    tNow.meta?.announceChannelId ||
    tNow.meta?.channelId;

  const roleId = process.env.TOURNEY_ROLE_ID || tNow.meta?.playerRoleId || null;
  const rolePing = roleId ? `<@&${roleId}>` : '';

  const text = `${rolePing} **All results are in for Round ${roundNum}.** Timers canceled. TOs may run **/tourney_next** when ready.`;
  await sendToChannel(client, tNow.meta.guildId, announceChanId, text);
}
