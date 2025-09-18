// lib/threadDM.js
const { ChannelType, ThreadAutoArchiveDuration, PermissionFlagsBits } = require('discord.js');
const { loadTournament, saveTournament } = require('./store');

/**
 * Decide which parent channel to host private threads under.
 * Priority: .env → tourney meta → paymentReviewChannelId → meta.channelId → fallback
 */
function pickParentChannelId(t, fallbackChannelId = null) {
  return (
    process.env.THREADS_PARENT_CHANNEL_ID ||
    t?.meta?.threadChannelId ||
    t?.meta?.paymentReviewChannelId ||
    t?.meta?.channelId ||
    fallbackChannelId ||
    null
  );
}

function sanitizeName(s, max = 95) {
  if (!s) return 'user';
  // Remove newlines, collapse spaces, trim, and cap length (Discord thread name limit is 100 chars)
  return s.replace(/[\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Create or reuse a per-user private thread for a tournament, add the user, and send a message.
 * Stores the threadId under players[userId].threadId for reuse (best-effort).
 *
 * @param {Client} client
 * @param {Object|string} tOrTid   Tournament object OR the tournament id string (RECOMMENDED)
 * @param {string} userId
 * @param {Object|string} payload  Whatever you'd pass to channel.send(...)
 * @param {string|null} fallbackChannelId Optional channel to use if no meta/env
 * @param {string|null} customName Optional thread name override
 * @returns {Promise<{ok:boolean, reason?:string, threadId?:string}>}
 */
async function sendThreadDM(client, tOrTid, userId, payload, fallbackChannelId = null, customName = null) {
  try {
    const isId = typeof tOrTid === 'string';
    const t = isId ? loadTournament(tOrTid) : tOrTid;
    if (!t) return { ok: false, reason: 'tournament_not_found' };

    // Stable tid key (so saveTournament can't explode)
    const tidKey =
      (isId && String(tOrTid)) ||
      t.meta?.tid ||
      t.tid ||
      t.meta?.id ||
      t.id ||
      null;

    const guildId = t.meta?.guildId || process.env.GUILD_ID;
    if (!guildId) return { ok: false, reason: 'guild_not_set' };

    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return { ok: false, reason: 'guild_fetch_failed' };

    const parentChannelId = pickParentChannelId(t, fallbackChannelId);
    if (!parentChannelId) return { ok: false, reason: 'no_parent_channel' };

    const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
    if (!parent) return { ok: false, reason: 'parent_channel_not_found' };

    // Private threads must be on a TEXT channel
    if (parent.type !== ChannelType.GuildText) {
      return { ok: false, reason: 'parent_channel_wrong_type' };
    }

    // Defensive perms check
    const me = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
    if (me) {
      const perms = parent.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.CreatePrivateThreads) || !perms?.has(PermissionFlagsBits.SendMessagesInThreads)) {
        return { ok: false, reason: 'missing_thread_perms' };
      }
    }

    // Try to reuse previously stored thread for this player
    const player = t.players?.[userId];
    let threadId = player?.threadId || null;
    let thread = null;

    if (threadId) {
      // Fetch via guild (safer than parent.threads.fetch)
      thread = await guild.channels.fetch(threadId).catch(() => null);
      if (!thread || !thread.isThread() || thread.parentId !== parent.id) {
        thread = null;
        threadId = null;
      }
    }

    if (!thread) {
      // Build name: "<username> - <tid>"
      const member = await guild.members.fetch(userId).catch(() => null);
      // Prefer displayName (nickname or username), else global/username, else short id
      const baseUser =
        member?.displayName ||
        member?.user?.globalName ||
        member?.user?.username ||
        `user-${String(userId).slice(-4)}`;

      const usernamePart = sanitizeName(baseUser);
      const eventPart = sanitizeName(tidKey || t.meta?.shortName || t.meta?.name || 'event');
      const finalName = sanitizeName(customName || `${usernamePart} - ${eventPart}`);

      thread = await parent.threads.create({
        name: finalName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        type: ChannelType.PrivateThread,
        reason: `Auto thread for user ${userId}`,
        invitable: false,
      });

      threadId = thread.id;

      // Record it if we have a safe tid
      if (tidKey) {
        t.players = t.players || {};
        t.players[userId] = { ...(t.players[userId] || {}), threadId };
        try {
          saveTournament(tidKey, t);
        } catch (e) {
          console.warn('[threadDM] saveTournament failed (non-fatal):', e?.message || e);
        }
      } else {
        console.warn('[threadDM] No stable tidKey found; skipping saveTournament (non-fatal).');
      }
    }

    // Add the user to the private thread (must be in guild)
    await thread.members.add(userId).catch(() => { /* already added / fine */ });

    // Send the message into the thread
    await thread.send(payload);

    return { ok: true, threadId };
  } catch (e) {
    console.error('[threadDM] failed:', e);
    return { ok: false, reason: 'exception' };
  }
}

module.exports = { sendThreadDM };
