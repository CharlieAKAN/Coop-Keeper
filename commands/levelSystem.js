const fs   = require('fs');
const path = require('path');
const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');


const cfg = {
  pointsPerMessage  : Number(process.env.POINTS_PER_MESSAGE  || 2),
  pointsPerMinuteVC : Number(process.env.POINTS_PER_MIN_VC   || 1),
  dailyDecay        : Number(process.env.DAILY_DECAY_POINTS  || 10),
  liveChannelId     : process.env.STREAM_LIVE_CHANNEL_ID,
  levels            : (process.env.LEVEL_BREAKS || '0,50,125,250,500,800,1200')
                      .split(',').map(n => Number(n.trim())),
  alwaysStreamingIds: (process.env.ALWAYS_STREAMING_IDS || '')
                      .split(',').map(s => s.trim()),

  streamingRoleId : process.env.STREAMING_ROLE_ID || '1397318388874875004',
  bonusRoleId     : process.env.BONUS_XP_ROLE_ID       || '445807117278904331',
  bonusMultiplier : Number(process.env.BONUS_XP_FACTOR) || 2,
  dataFile        : path.join(__dirname, '..', 'data', 'levels.json')
};

const requiredLevel = Number(
  process.env.STREAMING_REQUIRED_LEVEL ?? cfg.levels.length - 1
);

// ──────────────────────────────────────────
let xp = load();
const vcJoins = new Map();

const optOutFile = path.join(__dirname, '..', 'data', 'optOut.json');

function loadOptOut() {
  return fs.existsSync(optOutFile) ? JSON.parse(fs.readFileSync(optOutFile, 'utf8')) : {};
}
let optOut = loadOptOut();

function isOptedOut(userId) {
  // Always read fresh from disk to reflect the latest opt-out status
  try {
    const fresh = fs.existsSync(optOutFile)
      ? JSON.parse(fs.readFileSync(optOutFile, 'utf8'))
      : {};
    return !!fresh[userId];
  } catch (e) {
    console.error('[levelSystem] opt-out check failed:', e);
    return false;
  }
}


function load() { return fs.existsSync(cfg.dataFile) ? JSON.parse(fs.readFileSync(cfg.dataFile,'utf8')) : {}; }
function save() { fs.writeFileSync(cfg.dataFile, JSON.stringify(xp, null, 2)); }

function addXP(id, amount) {
  if (!xp[id]) xp[id] = 0;
  const prev = xp[id];
  xp[id] = Math.max(0, prev + amount);
  save();

  const prevLvl = levelFor(prev);
  const newLvl  = levelFor(xp[id]);
  return newLvl > prevLvl ? newLvl : null;
}

function levelFor(points) {
  let lvl = 0;
  for (let i = 0; i < cfg.levels.length; i++) {
    if (points >= cfg.levels[i]) lvl = i;
    else break;
  }
  return lvl;
}

function isEligible(id) {
  if (cfg.alwaysStreamingIds.includes(id)) return true;
  return levelFor(xp[id] || 0) >= requiredLevel;
}

// ──────────────────────────────────────────
module.exports = {
  getLevel(id) { return levelFor(xp[id] || 0); },
  getXP(id)    { return xp[id] || 0; },
  isUserEligible: isEligible,

  handleMessage(msg) {
    if (!msg.guild || msg.author.bot || isOptedOut(msg.author.id)) return;

    // check multiplier role
    const hasBonus = msg.member.roles.cache.has(cfg.bonusRoleId);
    const mult     = hasBonus ? cfg.bonusMultiplier : 1;

    const xpGain = cfg.pointsPerMessage * mult;
    const lvl    = addXP(msg.author.id, xpGain);

    if (lvl !== null) announceLevelUp(msg.member, lvl, msg.client);
  },

  async handleVoice(oldState, newState) {
    const id = newState.id;
    if (isOptedOut(id)) return;

    if (!oldState.channel && newState.channel) {
      vcJoins.set(id, Date.now());
    }

    if (oldState.channel && !newState.channel && vcJoins.has(id)) {
      const mins = (Date.now() - vcJoins.get(id)) / 60000;
      vcJoins.delete(id);

      // Fetch the member so we can check roles
      const member = await newState.guild.members.fetch(id);
      const hasBonus = member.roles.cache.has(cfg.bonusRoleId);
      const mult     = hasBonus ? cfg.bonusMultiplier : 1;
      if (hasBonus) console.log(`💥 Bonus XP multiplier applied for ${member.user.tag} (x${mult})`);
      const xpGain = mins * cfg.pointsPerMinuteVC * mult;
      const lvl    = addXP(id, xpGain);

      if (lvl !== null) {
        announceLevelUp(member, lvl, newState.client);
      }
    }
  },

  async init(client) {
    const guild = await client.guilds.fetch(process.env.HOME_GUILD_ID);
    await guild.members.fetch();

    for (const member of guild.members.cache.values()) {
      await syncMemberRole(member);
    }
    for (const member of guild.members.cache.values()) {
      const id = member.id;
      const hasBonus = member.roles.cache.has(cfg.bonusRoleId);
      if (hasBonus && !xp[id]) {
        xp[id] = 1; // give them just enough to be "active"
        console.log(`🌟 Initialized XP for bonus member ${member.user.tag}`);
      }
    }
    save();


    cron.schedule('0 4 * * *', async () => {
      for (const id in xp) addXP(id, -cfg.dailyDecay);

      await guild.members.fetch();
      for (const member of guild.members.cache.values()) {
        await syncMemberRole(member);
      }
      console.log('[levelSystem] Daily decay + role sync complete.');
    }, { timezone: 'Etc/UTC' });
  }
};

// ───── helpers ────────────────────────────
async function announceLevelUp(member, newLvl, client) {
  if (isOptedOut(member.id)) return; // 🔒 Don't send embed if opted out

  const liveChanMention = `<#${cfg.liveChannelId}>`;

  const embed = new EmbedBuilder()
    .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
    .setColor(0xFFD700) // Gold color
    .setTimestamp();

  if (newLvl === 3) {
    embed
      .setTitle(`🎉 You Made It To Level 3`)
      .setDescription(
        `<@${member.id}>, you're now eligible to appear in ${liveChanMention} when you stream!\n\n` +
        `Use the **</twitchlink:1397322569660629046>** command to link your Twitch account.\n\n` +
        `**If you have already done this, you don't need to do it again.**`
      );
  } else {
    embed
      .setTitle(`🎉 Leveled up!`)
      .setDescription(`<@${member.id}>, you just hit **Level ${newLvl}**! Keep it up!\n\n` +
        `You can opt-out of the Coop leveling using command **</no_leveling:1397322569660629045>**`
      );
  }

  try {
    const guild   = await client.guilds.fetch(member.guild.id);
    const channel = guild.channels.cache.get(cfg.liveChannelId)
                || await guild.channels.fetch(cfg.liveChannelId);

    if (channel && channel.isTextBased()) {
      await channel.send({
        content: `<@${member.id}>`,
        embeds: [embed]
      });
    } else {
      console.warn('[levelSystem] Could not find live channel. No message sent.');
    }
  } catch (e) {
    console.error('[levelSystem] announce fail', e);
  }

  await syncMemberRole(member);
}


// ───── helper to add/remove the streaming role ────────────────────────────
async function syncMemberRole(member) {
  const hasRole   = member.roles.cache.has(cfg.streamingRoleId);
  const qualifies = isEligible(member.id);

  try {
    if (qualifies && !hasRole) {
      await member.roles.add(cfg.streamingRoleId);
      const isOverride = cfg.alwaysStreamingIds.includes(member.id);
      console.log(
        `✅ Added Streaming role to ${member.user.tag}` +
        (isOverride ? ' (always allowed)' : '')
      );
    } else if (!qualifies && hasRole) {
      await member.roles.remove(cfg.streamingRoleId);
      console.log(`❌ Removed Streaming role from ${member.user.tag}`);
    }
  } catch (err) {
    console.error('[levelSystem] role sync fail', err);
  }
}
