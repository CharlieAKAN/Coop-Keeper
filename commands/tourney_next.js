// commands/tourney_next.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
} = require('discord.js');
const { loadTournament, listPlayers, setRoundPairings, saveTournament } = require('../lib/store');
const { swissPair } = require('../lib/pairings');
const { requireAdmin } = require('../lib/auth');
const { scheduleRoundTimers } = require('../lib/roundTimers');

const builder = new SlashCommandBuilder()
  .setName('tourney_next')
  .setDescription('Generate pairings for the next round (file-based)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(o=>o.setName('tid').setDescription('Tournament ID').setRequired(true))
  .addBooleanOption(o=>o.setName('force').setDescription('Bypass unreported-table check').setRequired(false));

if (typeof builder.setContexts === 'function') builder.setContexts(InteractionContextType.Guild);
else builder.setDMPermission(false);

module.exports.data = builder;

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

module.exports.execute = async (interaction) => {
  if (!(await requireAdmin(interaction))) return;

  const tid   = interaction.options.getString('tid', true);
  const force = interaction.options.getBoolean('force') ?? false;

  const t = loadTournament(tid);
  if (!t) return interaction.reply({ ephemeral:true, content:'❌ Tournament not found.' });
  if ((t.meta?.status || 'registration') !== 'in_progress') {
    return interaction.reply({ ephemeral:true, content:'❌ Tournament is not in progress.' });
  }

  // ── Safeguard: ensure current round is fully reported ─────────────────────
  const curRound = Number(t.meta?.currentRound || 0);
  if (!curRound) {
    return interaction.reply({ ephemeral:true, content:'❌ No active round. Run **/tourney_start** first.' });
  }

  const cur = t.rounds?.[String(curRound)];
  const pairings = Array.isArray(cur?.pairings) ? cur.pairings : null;
  if (!pairings || pairings.length === 0) {
    return interaction.reply({ ephemeral:true, content:`❌ No pairings found for Round ${curRound}. Run **/tourney_start** first.` });
  }

  const pending = pairings.filter(m => !m.result || m.result === 'PENDING');
  if (pending.length > 0 && !force) {
    const sample = pending.slice(0, 10).map(m => `Table ${m.table}${m.bye ? ' (BYE)' : ''}`).join(', ');
    return interaction.reply({
      ephemeral:true,
      content:
        `⏳ **Hold up — ${pending.length} table(s) still unreported in Round ${curRound}.**\n` +
        (sample ? `Pending: ${sample}${pending.length > 10 ? ', …' : ''}\n` : '') +
        `Ask players to report (or use **/tourney_override_result**) and try again.\n` +
        `If you must proceed anyway, re-run this with **force: true**.`
    });
  }

  // ── Build next round’s eligible player pool ───────────────────────────────
  const next = curRound + 1;
  let players = listPlayers(tid).filter(p => !p.dropped);
  if (t.meta.paidRequired)    players = players.filter(p => p.paymentStatus === 'verified');
  if (t.meta.requireDecklist) players = players.filter(p => (p.deck?.url || p.deck?.fileUrl || p.deck?.text));
  if (players.length < 2) return interaction.reply({ ephemeral:true, content:'❌ Need at least 2 eligible players.' });

  const nextPairings = swissPair(tid, next, players, loadTournament);
  if (!Array.isArray(nextPairings) || nextPairings.length === 0) {
    return interaction.reply({ ephemeral:true, content:'❌ Could not generate pairings (swissPair returned empty).' });
  }

  // Save pairings & advance round (store helper sets status/currentRound)
  setRoundPairings(tid, next, nextPairings);

  // Build pairings announcement
  const t2 = loadTournament(tid); // refresh after setRoundPairings
  let msg = `**${t2.meta.name || tid} — Round ${next} Pairings**\n`;
  for (const p of nextPairings) {
    const label = t2.meta.tables?.labelMap?.[String(p.table)] || `Table ${p.table}`;
    if (p.bye) msg += `${label}: (A) <@${p.playerA}> has a **BYE**\n`;
    else       msg += `${label}: (A) <@${p.playerA}> vs (B) <@${p.playerB}>\n`;
  }

  // Post pairings to PAIRING_CHANNEL_ID if available
  const pairingChanId = process.env.PAIRING_CHANNEL_ID || t2.meta?.pairingChannelId || t2.meta?.channelId;
  await sendToChannel(interaction.client, t2.meta.guildId, pairingChanId, msg);

  // --- Centralized timed announcements (same flow as /tourney_start) -------
  const announceChanId = process.env.TOURNEY_ANNOUNCE_CHANNEL_ID || t2.meta?.announceChannelId || t2.meta?.channelId;
  const roleId         = process.env.TOURNEY_ROLE_ID            || t2.meta?.playerRoleId       || null;
  const winChanId      = process.env.TOURNEY_WIN_CHANNEL_ID     || t2.meta?.winChannelId       || t2.meta?.channelId;

  const roundMins = Number(t2.meta?.roundTimeMins || 35);
  const otMode    = t2.meta?.overtime?.mode || process.env.OT_MODE || 'extra_time';
  const otMinutes = (otMode === 'extra_time')
    ? (t2.meta?.overtime?.minutes ?? Number(process.env.OT_MINUTES || 5))
    : 0;

  // Snapshot the schedule (handy for debugging/ops)
  t2.meta.roundSchedule = {
    round: next,
    postedAt: new Date().toISOString(),
    prepMinutes: 5,
    roundMinutes: roundMins,
    overtime: { mode: otMode, minutes: otMinutes }
  };
  saveTournament(tid, t2);

  // Use centralized scheduler so timers can be cancelled when the round auto-ends
  scheduleRoundTimers({
    client: interaction.client,
    guildId: t2.meta.guildId,
    announceChanId,
    winChanId,
    roleId,
    pairingChanId,
    tid,
    round: next,
    roundMins,
    otMode,
    otMinutes
  });

  // Quiet confirmation to the admin
  return interaction.reply({
    ephemeral: true,
    content: `✅ Round ${next} pairings generated.${pending.length > 0 && force ? ' (Forced with unresolved tables)' : ''}`
  });
};
