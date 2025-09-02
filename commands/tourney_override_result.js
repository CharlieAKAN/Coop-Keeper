// commands/tourney_override_result.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  MessageFlags,
} = require('discord.js');
const { loadTournament, saveTournament } = require('../lib/store');

const EPHEMERAL = (MessageFlags && MessageFlags.Ephemeral) ? MessageFlags.Ephemeral : 64;

module.exports.data = new SlashCommandBuilder()
  .setName('tourney_override_result')
  .setDescription('Admin: override or clear a table result for the current round')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o => o.setName('tid').setDescription('Tournament ID').setRequired(true))
  .addIntegerOption(o => o.setName('table').setDescription('Table number').setRequired(true).setMinValue(1))
  .addStringOption(o => o.setName('result').setDescription('A | B | D (ignored if clear=true)').setRequired(false)
    .addChoices(
      { name:'Player A wins', value:'A' },
      { name:'Player B wins', value:'B' },
      { name:'Draw',          value:'D' },
    ))
  .addIntegerOption(o => o.setName('gw_a').setDescription('Game wins for Player A (optional)').setRequired(false).setMinValue(0))
  .addIntegerOption(o => o.setName('gw_b').setDescription('Game wins for Player B (optional)').setRequired(false).setMinValue(0))
  .addBooleanOption(o => o.setName('clear').setDescription('Clear existing result and undo scoring').setRequired(false));

if (typeof module.exports.data.setContexts === 'function') {
  module.exports.data.setContexts(InteractionContextType.Guild);
} else {
  module.exports.data.setDMPermission(false);
}

function ensureRecord(p) {
  p.record = p.record || { wins:0, losses:0, draws:0 };
  if (typeof p.score !== 'number') p.score = 0;
}

function applyScoring(pA, pB, res) {
  ensureRecord(pA); ensureRecord(pB);
  if (res === 'A') {
    pA.score += 3; pA.record.wins += 1;
    pB.record.losses += 1;
  } else if (res === 'B') {
    pB.score += 3; pB.record.wins += 1;
    pA.record.losses += 1;
  } else if (res === 'D') {
    pA.score += 1; pB.score += 1;
    pA.record.draws += 1; pB.record.draws += 1;
  }
}

function rollbackScoring(pA, pB, res) {
  ensureRecord(pA); ensureRecord(pB);
  if (res === 'A') {
    pA.score -= 3; pA.record.wins -= 1;
    pB.record.losses -= 1;
  } else if (res === 'B') {
    pB.score -= 3; pB.record.wins -= 1;
    pA.record.losses -= 1;
  } else if (res === 'D') {
    pA.score -= 1; pB.score -= 1;
    pA.record.draws -= 1; pB.record.draws -= 1;
  }
  // keep from going negative due to corrupted data
  ['wins','losses','draws'].forEach(k=>{
    pA.record[k] = Math.max(0, pA.record[k]||0);
    pB.record[k] = Math.max(0, pB.record[k]||0);
  });
  pA.score = Math.max(0, pA.score||0);
  pB.score = Math.max(0, pB.score||0);
}

module.exports.execute = async (interaction) => {
  const tid     = interaction.options.getString('tid', true);
  const table   = interaction.options.getInteger('table', true);
  const result  = interaction.options.getString('result') || null; // 'A'|'B'|'D'
  const gwAOpt  = interaction.options.getInteger('gw_a');
  const gwBOpt  = interaction.options.getInteger('gw_b');
  const clear   = interaction.options.getBoolean('clear') ?? false;

  const t = loadTournament(tid);
  if (!t) return interaction.reply({ flags: EPHEMERAL, content: '❌ Tournament not found.' });

  // Require in-progress to avoid weirdness (adjust if you want to permit historical fixes)
  if ((t.meta?.status || 'registration') !== 'in_progress') {
    return interaction.reply({ flags: EPHEMERAL, content: '⏳ Event not in progress. You can only override the active round.' });
  }

  const roundNum = Number(t.meta?.currentRound || 0);
  const round = t.rounds?.[String(roundNum)];
  if (!round || !Array.isArray(round.pairings) || round.pairings.length === 0) {
    return interaction.reply({ flags: EPHEMERAL, content: `❌ No pairings found for Round ${roundNum}.` });
  }

  const m = round.pairings.find(p => p.table === table);
  if (!m) return interaction.reply({ flags: EPHEMERAL, content: `❌ Table ${table} not found for Round ${roundNum}.` });

  // Guard: players must exist
  const pA = t.players?.[m.playerA];
  const pB = m.bye ? null : t.players?.[m.playerB];
  if (!pA || (!m.bye && !pB)) {
    return interaction.reply({ flags: EPHEMERAL, content: '❌ Player references missing for that table.' });
  }

  // 1) Roll back any existing scored result
  if (m.result && m.result !== 'PENDING') {
    if (m.bye) {
      // For BYE, previous result should always be A; rollback A’s win if present
      rollbackScoring(pA, pA, 'A'); // harmless: we ignore second param values we touch
    } else {
      rollbackScoring(pA, pB, m.result);
    }
  }

  if (clear) {
    // 2a) Clear result entirely
    delete m.result;
    delete m.reportedBy;
    delete m.reportedAt;
    delete m.gwA;
    delete m.gwB;
    delete m.dropConcession;

    saveTournament(tid, t);
    return interaction.reply({
      content: `🧹 Cleared result for **Round ${roundNum} – Table ${table}**.`,
      flags: EPHEMERAL
    });
  }

  // 2b) Apply new result
  if (!result || !['A','B','D'].includes(result)) {
    return interaction.reply({ flags: EPHEMERAL, content: '❌ Provide a valid result: A, B, or D (or set **clear: true**).' });
  }

  // Optional game wins sanity (not enforced strictly; just store if provided)
  if (typeof gwAOpt === 'number') m.gwA = gwAOpt;
  if (typeof gwBOpt === 'number') m.gwB = gwBOpt;

  m.result = result;
  m.reportedBy = `admin:${interaction.user.id}`;
  m.reportedAt = new Date().toISOString();

  if (m.bye) {
    // BYE is always a win for A regardless of chosen result; but we’ll respect admin intent:
    if (result !== 'A') {
      // You can choose to force A here; or allow admin to set D/B. We'll respect admin request:
      // no-op
    }
    applyScoring(pA, pA, result); // applies to A only effectively for A/D (B not seated)
  } else {
    applyScoring(pA, pB, result);
  }

  saveTournament(tid, t);

  const msg =
    result === 'A' ? `✅ **Override:** Table ${table} — <@${m.playerA}> wins.` :
    result === 'B' ? `✅ **Override:** Table ${table} — <@${m.playerB}> wins.` :
                     `✅ **Override:** Table ${table} — Draw recorded.`;

  // Send to TOURNEY_WIN_CHANNEL_ID if configured
  const winChanId = process.env.TOURNEY_WIN_CHANNEL_ID;
  if (winChanId) {
    try {
      const guild = interaction.client.guilds.cache.get(t.meta.guildId);
      const chan = guild ? await guild.channels.fetch(winChanId).catch(() => null) : null;
      if (chan) await chan.send(msg);
    } catch (err) {
      console.warn(`[tourney_override_result] Failed to send to win channel:`, err);
    }
  }

  // Ephemeral reply to the admin who overrode
  return interaction.reply({ content: msg, flags: EPHEMERAL });
};
