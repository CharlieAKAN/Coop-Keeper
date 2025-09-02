// lib/roundTimers.js
// In-process timer registry (not persisted). One set per (tid, round).
const timers = new Map(); // key: `${tid}:${round}` -> { prep, start, ot, final }

function key(tid, round) { return `${tid}:${round}`; }

function clearRoundTimers(tid, round) {
  const k = key(tid, round);
  const bundle = timers.get(k);
  if (!bundle) return false;
  for (const id of Object.values(bundle)) {
    if (id) try { clearTimeout(id); } catch {}
  }
  timers.delete(k);
  return true;
}

function scheduleRoundTimers({ client, guildId, announceChanId, winChanId, roleId, pairingChanId, tid, round, roundMins, otMode, otMinutes }) {
  // always clear existing timers for this round/tid first (idempotent)
  clearRoundTimers(tid, round);

  const rolePing = roleId ? `<@&${roleId}>` : '@players';
  const pairingChanPing = pairingChanId ? `<#${pairingChanId}>` : 'the pairings channel';
  const winChanPing = winChanId ? `<#${winChanId}>` : 'the results channel';

  const ms = (m) => Math.max(0, Number(m || 0)) * 60 * 1000;

  async function send(channelId, content) {
    if (!channelId) return;
    try {
      const guild = client.guilds.cache.get(guildId);
      const chan = guild ? await guild.channels.fetch(channelId).catch(() => null) : null;
      if (chan) await chan.send(content);
    } catch {}
  }

  const prepMsg   = `${rolePing} you have **5 minutes** to get to your tables assigned to you in ${pairingChanPing}…`;
  const startMsg  = `${rolePing} **start your matches!** You have **${roundMins} minutes!**`;
  const otMsg     = `${rolePing}, **${otMinutes} minute** over time has started!`;
  const finalMsg  = `${rolePing} **MATCHES ARE OVER.** Please report in ${winChanPing} who won the match.`;

  const prepId  = setTimeout(() => send(announceChanId, prepMsg), 0);
  const startId = setTimeout(() => send(announceChanId, startMsg), ms(5));
  let otId = null, finalId = null;

  const afterMain = ms(5 + roundMins);
  if (otMode === 'extra_time' && otMinutes > 0) {
    otId    = setTimeout(() => send(announceChanId, otMsg), afterMain);
    finalId = setTimeout(() => send(announceChanId, finalMsg), afterMain + ms(otMinutes));
  } else {
    finalId = setTimeout(() => send(announceChanId, finalMsg), afterMain);
  }

  timers.set(key(tid, round), { prep: prepId, start: startId, ot: otId, final: finalId });
}

function hasTimers(tid, round) {
  return timers.has(key(tid, round));
}

module.exports = {
  scheduleRoundTimers,
  clearRoundTimers,
  hasTimers,
};
