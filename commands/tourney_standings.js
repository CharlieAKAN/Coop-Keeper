// commands/tourney_standings.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const { loadTournament } = require('../lib/store');

const EPHEMERAL = (MessageFlags && MessageFlags.Ephemeral) ? MessageFlags.Ephemeral : 64;

module.exports.data = new SlashCommandBuilder()
  .setName('tourney_standings')
  .setDescription('Show standings (admin only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o=>o.setName('tid').setDescription('Tournament ID').setRequired(true))
  .addIntegerOption(o=>o.setName('round').setDescription('Round number (default: current)').setRequired(false).setMinValue(1))
  .addIntegerOption(o=>o.setName('top').setDescription('How many to display (default: 10)').setRequired(false).setMinValue(1).setMaxValue(100))
  .addBooleanOption(o=>o.setName('public').setDescription('Post publicly (default: false)').setRequired(false));

if (typeof module.exports.data.setContexts === 'function') {
  module.exports.data.setContexts(InteractionContextType.Guild);
} else {
  module.exports.data.setDMPermission(false);
}

module.exports.execute = async (interaction) => {
  const tid   = interaction.options.getString('tid', true);
  const round = interaction.options.getInteger('round') ?? null;
  const topN  = interaction.options.getInteger('top') ?? 10;
  const isPublic = interaction.options.getBoolean('public') ?? false;

  const t = loadTournament(tid);
  if (!t) return interaction.reply({ flags: EPHEMERAL, content: '❌ Tournament not found.' });

  const currentRound = Number(t.meta?.currentRound || 0);
  const roundNum = round ?? currentRound;
  if (!roundNum) {
    return interaction.reply({ flags: EPHEMERAL, content: '❌ No rounds have been started yet.' });
  }

  // Collect player rows
  const rows = Object.values(t.players || {})
    .filter(p => !p.dropped)
    .map(p => {
      const wins  = p.record?.wins ?? 0;
      const losses= p.record?.losses ?? 0;
      const draws = p.record?.draws ?? 0;
      const pts   = p.score ?? (wins*3 + draws*1);
      return {
        id: p.userId,
        name: p.displayName || p.userId,
        wins, losses, draws, pts
      };
    })
    .sort((a,b)=> (b.pts - a.pts) || (b.wins - a.wins) || a.name.localeCompare(b.name));

  const shown = rows.slice(0, topN);

  // Build embed
  const embed = new EmbedBuilder()
    .setTitle(`${t.meta?.name || tid} — Standings after Round ${roundNum}`)
    .setColor(0x3498db)
    .setFooter({ text: `Showing top ${shown.length}${rows.length>shown.length?` of ${rows.length}`:''}` })
    .setTimestamp(new Date());

  let desc = '';
  shown.forEach((r, idx) => {
    desc += `**#${idx+1}** — ${r.name}\n`;
    desc += `Points: ${r.pts} | Record: ${r.wins}-${r.losses}-${r.draws}\n\n`;
  });
  embed.setDescription(desc);

  // CSV attachment for TOs
  const csvLines = ['rank,player_id,player,points,wins,losses,draws'];
  rows.forEach((r, idx) => {
    csvLines.push([idx+1, r.id, `"${r.name.replace(/"/g,'""')}"`, r.pts, r.wins, r.losses, r.draws].join(','));
  });
  const csvBuf = Buffer.from(csvLines.join('\n'), 'utf8');
  const csv = new AttachmentBuilder(csvBuf, { name: `standings_${tid}_R${roundNum}.csv` });

  const payload = {
    embeds: [embed],   // embed always renders above
    files: [csv],      // CSV will show below as a download
    content: ''        // (optional) add a line above or below if you want
  };
  if (isPublic) {
    return interaction.reply(payload);
  } else {
    return interaction.reply({ ...payload, flags: EPHEMERAL });
  }
};
