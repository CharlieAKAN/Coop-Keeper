// commands/tourney_start.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  MessageFlags,
} = require('discord.js');
const { loadTournament, listPlayers, setRoundPairings, saveTournament } = require('../lib/store');
const { swissPair } = require('../lib/pairings');
const { requireAdmin } = require('../lib/auth');
const { scheduleRoundTimers } = require('../lib/roundTimers');

const EPHEMERAL = (MessageFlags && MessageFlags.Ephemeral) ? MessageFlags.Ephemeral : 64;

const builder = new SlashCommandBuilder()
  .setName('tourney_start')
  .setDescription('Start the tournament and create Round 1 pairings (file-based)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(o => o.setName('tid').setDescription('Tournament ID').setRequired(true));

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

  const tid = interaction.options.getString('tid', true);
  let t = loadTournament(tid);
  if (!t) return interaction.reply({ flags: EPHEMERAL, content: '❌ Tournament not found.' });

  let players = listPlayers(tid).filter(p => !p.dropped);
  if (t.meta.paidRequired) players = players.filter(p => p.paymentStatus === 'verified');
  if (t.meta.requireDecklist) players = players.filter(p => (p.deck?.url || p.deck?.fileUrl || p.deck?.text));
  if (players.length < 2) return interaction.reply({ flags: EPHEMERAL, content: 'Need at least 2 eligible players.' });

  const roundNum = 1;

  // 1) Build pairings
  const pairings = swissPair(tid, roundNum, players, loadTournament) || [];
  if (!Array.isArray(pairings) || pairings.length === 0) {
    return interaction.reply({ flags: EPHEMERAL, content: '❌ Could not generate pairings (swissPair returned empty).' });
  }

  // 2) Save pairings (also sets currentRound + status=in_progress in store.js)
  setRoundPairings(tid, roundNum, pairings);

  // 3) Re-read to verify
  t = loadTournament(tid);
  const saved = t?.rounds?.[String(roundNum)]?.pairings || [];
  if (!Array.isArray(saved) || saved.length === 0) {
    console.error('[tourney_start] Pairings failed to persist. Check store paths/permissions.');
    return interaction.reply({ flags: EPHEMERAL, content: '❌ Pairings failed to persist to storage. Check bot logs and file paths.' });
  }

  // 4) Pairings message
  let msg = `**${t.meta.name || tid} — Round ${roundNum} Pairings**\n`;
  for (const p of saved) {
    const label = t.meta.tables?.labelMap?.[String(p.table)] || `Table ${p.table}`;
    if (p.bye) {
      msg += `${label}: (A) <@${p.playerA}> has a **BYE**\n`;
    } else {
      msg += `${label}: (A) <@${p.playerA}> vs (B) <@${p.playerB}>\n`;
    }
  }

  // 5) Send pairings to PAIRING_CHANNEL_ID (or fallback where command ran)
  const pairingChanId = process.env.PAIRING_CHANNEL_ID || t.meta?.pairingChannelId || t.meta?.channelId;
  const pairingSent = await sendToChannel(interaction.client, t.meta.guildId, pairingChanId, msg);
  if (!pairingSent) {
    try { await interaction.channel.send(msg); } catch {}
  }

  // 6) Schedule timed announcements via centralized timer manager
  const announceChanId = process.env.TOURNEY_ANNOUNCE_CHANNEL_ID || t.meta?.announceChannelId || t.meta?.channelId;
  const roleId         = process.env.TOURNEY_ROLE_ID            || t.meta?.playerRoleId       || null;
  const winChanId      = process.env.TOURNEY_WIN_CHANNEL_ID     || t.meta?.winChannelId       || t.meta?.channelId;

  const roundMins = Number(t.meta?.roundTimeMins || 35);
  const otMode    = t.meta?.overtime?.mode || process.env.OT_MODE || 'extra_time';
  const otMinutes = (otMode === 'extra_time')
    ? (t.meta?.overtime?.minutes ?? Number(process.env.OT_MINUTES || 5))
    : 0;

  // Store a small schedule snapshot (optional, helpful for debugging)
  t.meta.roundSchedule = {
    round: roundNum,
    postedAt: new Date().toISOString(),
    prepMinutes: 5,
    roundMinutes: roundMins,
    overtime: { mode: otMode, minutes: otMinutes }
  };
  saveTournament(tid, t);

  // Centralized scheduling (these timers can be cleared when the last table reports)
  scheduleRoundTimers({
    client: interaction.client,
    guildId: t.meta.guildId,
    announceChanId,
    winChanId,
    roleId,
    pairingChanId,
    tid,
    round: roundNum,
    roundMins,
    otMode,
    otMinutes
  });

  // 7) Ephemeral confirmation to the admin
  return interaction.reply({ flags: EPHEMERAL, content: '✅ Round 1 pairings posted and timer announcements scheduled.' });
};
