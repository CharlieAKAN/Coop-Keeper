// chickiesLIVE.js
const { ActivityType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

// If you're on Node < 18, uncomment these two lines:
// const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
// global.fetch = fetch;

/** ── ENV / CONFIG ───────────────────────────────────────────── */
const STREAMER_DISCORD_ID = (process.env.CHICKIES_DISCORD_ID || '182666240370802688').trim();
const TARGET_CHANNEL_ID   = (process.env.CHICKIES_ANNOUNCE_CHANNEL_ID || '1330060342729900072').trim();

const TWITCH_LOGIN  = process.env.CHICKIES_TWITCH_LOGIN?.trim();   // e.g., 'chickiestendies' or 'charlieakan'
const TWITCH_CLIENT = process.env.TWITCH_CLIENT_ID?.trim();
const TWITCH_SECRET = process.env.TWITCH_CLIENT_SECRET?.trim();

const TWITCH_ICON   = 'https://clipartcraft.com/images/twitch-logo.png'; // requested logo
const COOLDOWN_MS   = 8 * 60 * 60 * 1000; // 8h

/** ── STATE ──────────────────────────────────────────────────── */
const STREAM_STATE = { lastStreamId: null, lastAnnounceAt: 0 };

/** ── TWITCH HELPERS ─────────────────────────────────────────── */
let twitchToken = null;
let twitchTokenExpiresAt = 0;

async function getTwitchAppToken(fetchFn = fetch) {
  if (!TWITCH_CLIENT || !TWITCH_SECRET) {
    console.warn('[chickiesLIVE] Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET');
    return null;
  }
  if (twitchToken && Date.now() < twitchTokenExpiresAt - 60_000) return twitchToken;

  const body = new URLSearchParams({
    client_id: TWITCH_CLIENT,
    client_secret: TWITCH_SECRET,
    grant_type: 'client_credentials',
  });

  const res = await fetchFn('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!res.ok) {
    console.warn('[chickiesLIVE] Failed to get Twitch token', await res.text());
    return null;
  }
  const data = await res.json();
  twitchToken = data.access_token;
  twitchTokenExpiresAt = Date.now() + (data.expires_in * 1000);
  return twitchToken;
}

async function fetchTwitchUserId(login, fetchFn = fetch) {
  if (!login) return null;
  const token = await getTwitchAppToken(fetchFn);
  if (!token) return null;

  const url = new URL('https://api.twitch.tv/helix/users');
  url.searchParams.set('login', login);

  const res = await fetchFn(url, {
    headers: { 'Client-ID': TWITCH_CLIENT, 'Authorization': `Bearer ${token}` }
  });

  if (!res.ok) {
    console.warn('[chickiesLIVE] users lookup failed', await res.text());
    return null;
  }
  const data = await res.json();
  return data.data?.[0]?.id || null;
}

function normalizeThumb(tmpl) {
  if (!tmpl) return null;
  if (tmpl.includes('{width}x{height}')) {
    return tmpl.replace('{width}x{height}', '1280x720');
  }
  return tmpl.replace('{width}', '1280').replace('{height}', '720');
}

async function fetchTwitchStream(fetchFn = fetch) {
  if (!TWITCH_LOGIN || !TWITCH_CLIENT) return null;

  const userId = await fetchTwitchUserId(TWITCH_LOGIN, fetchFn);
  if (!userId) return null;

  const token = await getTwitchAppToken(fetchFn);
  if (!token) return null;

  const url = new URL('https://api.twitch.tv/helix/streams');
  url.searchParams.set('user_id', userId);

  const res = await fetchFn(url, {
    headers: { 'Client-ID': TWITCH_CLIENT, 'Authorization': `Bearer ${token}` }
  });

  if (res.status === 429) {
    console.warn('[chickiesLIVE] Twitch rate-limited this request.');
    return null;
  }
  if (!res.ok) {
    console.warn('[chickiesLIVE] streams lookup failed', await res.text());
    return null;
  }

  const json = await res.json();
  const stream = json.data?.[0] || null;
  if (!stream) return null;

  return {
    id: stream.id,
    title: stream.title,
    gameName: stream.game_name || null,
    viewerCount: typeof stream.viewer_count === 'number' ? stream.viewer_count : null,
    startedAt: stream.started_at,
    url: `https://twitch.tv/${TWITCH_LOGIN}`,
    thumb: normalizeThumb(stream.thumbnail_url),
  };
}

/** ── DISCORD HELPERS ───────────────────────────────────────── */
function isStreamingActivity(presence) {
  return presence?.activities?.some(a => a.type === ActivityType.Streaming);
}
function getStreamingActivity(presence) {
  return presence?.activities?.find(a => a.type === ActivityType.Streaming) || null;
}

async function resolveChannelInGuild(member, channelId) {
  try {
    return member.guild.channels.resolve(channelId) || await member.guild.channels.fetch(channelId);
  } catch (e) {
    console.warn('[chickiesLIVE] Could not resolve target channel:', channelId, e?.message || e);
    return null;
  }
}

function canSend(channel, me) {
  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.ViewChannel)) return { ok: false, why: 'View Channel' };
  if (channel.isThread()) {
    if (!perms?.has(PermissionFlagsBits.SendMessagesInThreads)) return { ok: false, why: 'Send Messages in Threads' };
  } else {
    if (!perms?.has(PermissionFlagsBits.SendMessages)) return { ok: false, why: 'Send Messages' };
  }
  return { ok: true, why: '' };
}

/** ── ANNOUNCE ──────────────────────────────────────────────── */
async function announceLive(client, member, streamInfo, activityUrl, titleFromDiscord) {
  const now = Date.now();
  if (now - STREAM_STATE.lastAnnounceAt < COOLDOWN_MS) {
    console.log('[chickiesLIVE] Cooldown active, skipping.');
    return;
  }
  if (streamInfo?.id && STREAM_STATE.lastStreamId === streamInfo.id) {
    console.log('[chickiesLIVE] Already announced this stream id, skipping.');
    return;
  }

  const channel = await resolveChannelInGuild(member, TARGET_CHANNEL_ID);
  if (!channel) return;

  const me = await member.guild.members.fetchMe();
  const permCheck = canSend(channel, me);
  if (!permCheck.ok) {
    console.warn(`[chickiesLIVE] Missing "${permCheck.why}" in #${channel.name} (${channel.id}).`);
    return;
  }
  if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.MentionEveryone)) {
    console.warn(`[chickiesLIVE] Bot lacks "Mention Everyone" in #${channel.name}. The @everyone may not ping.`);
  }

  const liveUrl = streamInfo?.url || activityUrl || `https://twitch.tv/${TWITCH_LOGIN || member.user.username}`;
  const title   = streamInfo?.title || titleFromDiscord || `${member.user.username} is live!`;

  // Build description lines: title + metadata line
  const metaParts = [];
  if (streamInfo?.gameName) metaParts.push(`Category: **${streamInfo.gameName}**`);
  const metaLine = metaParts.length ? `\n${metaParts.join('')}` : '';

  const embed = new EmbedBuilder()
    .setColor(0x9146ff)
    .setAuthor({ name: 'LIVE ON TWITCH 🔴', iconURL: TWITCH_ICON, url: liveUrl })
    .setTitle(`**${title}**`)
    .setDescription(metaLine || '\u200B')
    .setURL(liveUrl)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setTimestamp();

  if (streamInfo?.thumb) {
    embed.setImage(`${streamInfo.thumb}?cb=${Date.now()}`);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('📺 WATCH CHICKIES LIVE 🐔').setStyle(ButtonStyle.Link).setURL(liveUrl)
  );

  await channel.send({
    content: '@everyone Chickies is live!',
    embeds: [embed],
    components: [row],
    allowedMentions: { parse: ['everyone'] },
  });

  STREAM_STATE.lastAnnounceAt = now;
  if (streamInfo?.id) STREAM_STATE.lastStreamId = streamInfo.id;

  console.log('[chickiesLIVE] Announced stream for', member.user.tag, 'in channel', channel.id);
}

/** ── INIT ──────────────────────────────────────────────────── */
function init(client) {
  client.on('presenceUpdate', async (oldP, newP) => {
    try {
      const member = newP?.member;
      if (!member || member.user.id !== STREAMER_DISCORD_ID) return;

      const wasStreaming = isStreamingActivity(oldP);
      const isStreaming  = isStreamingActivity(newP);
      if (!wasStreaming && isStreaming) {
        const act = getStreamingActivity(newP);
        let streamInfo = null;
        try {
          streamInfo = await fetchTwitchStream();
        } catch (e) {
          console.warn('[chickiesLIVE] Twitch lookup failed:', e?.message || e);
        }
        await announceLive(
          client,
          member,
          streamInfo,
          act?.url || null,
          act?.state || null
        );
      }
    } catch (err) {
      console.error('[chickiesLIVE] presenceUpdate error:', err);
    }
  });
}

module.exports = { init };
