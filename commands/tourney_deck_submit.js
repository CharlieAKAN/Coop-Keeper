// commands/tourney_deck_submit.js
const {
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');

const { loadTournament, saveTournament } = require('../lib/store');
const { validateDeck } = require('../lib/deckrules');

// Version-safe ephemeral flag (64 == EPHEMERAL)
const EPHEMERAL = (MessageFlags && MessageFlags.Ephemeral) ? MessageFlags.Ephemeral : 64;

// ---- helpers ----
function stripCodeFences(s) {
  if (!s) return s;
  let t = String(s).trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[^\n]*\n/, '');
    if (t.endsWith('```')) t = t.slice(0, -3);
  }
  return t.trim();
}

function normalizeDeckText(text) {
  if (!text) return null;
  let t = stripCodeFences(text)
    .replace(/\r\n/g, '\n')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  return t.trim();
}

/**
 * Parse lines like "4xOP08-010" or "1x OP08-001"
 * Returns { lines:[{qty,code,raw}], total, invalid:[rawLine,...] }
 */
function parseDeck(text) {
  const empty = { lines: [], total: 0, invalid: [] };
  if (!text) return empty;

  // Normalize separators & whitespace
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/[,\uFF0C;]+/g, '\n')  // commas/Chinese commas/semicolons → newline
    .replace(/\s{2,}/g, ' ')
    .trim();

  const parsed = [];
  const invalid = [];

  // Try line-by-line first
  const lines = cleaned.split('\n').map(s => s.trim()).filter(Boolean);
  const rxLine = /^(?:(\d+)\s*x?\s+)?([A-Za-z0-9][A-Za-z0-9\-._/]+)\s*$/i;

  let lineModeWorked = true;
  for (const raw of lines) {
    const m = raw.match(rxLine);
    if (!m) { lineModeWorked = false; break; }
    const qty = m[1] ? parseInt(m[1], 10) : 1;
    const code = m[2].toUpperCase();
    parsed.push({ qty, code, raw });
  }

  if (!lineModeWorked) {
    // Fallback: tokenize entire string (supports one-line pastes)
    parsed.length = 0;
    invalid.length = 0;
    const rxToken = /(\d+)\s*x?\s*([A-Za-z0-9][A-Za-z0-9\-._/]+)/gi;
    let match; let consumedAny = false;
    while ((match = rxToken.exec(text)) !== null) {
      consumedAny = true;
      const qty = parseInt(match[1], 10);
      const code = match[2].toUpperCase();
      parsed.push({ qty, code, raw: `${qty}x${code}` });
    }
    if (!consumedAny) invalid.push(text.trim());
  }

  const total = parsed.reduce((a, b) => a + b.qty, 0);
  return { lines: parsed, total, invalid };
}

module.exports.data = new SlashCommandBuilder()
  .setName('tourney_deck_submit')
  .setDescription('Submit your decklist (text only)')
  .addStringOption(o=>o.setName('tid').setDescription('Tournament ID').setRequired(true))
  .addStringOption(o=>o.setName('text').setDescription('Paste your deck (e.g., 4xOP08-010)').setRequired(true));

module.exports.execute = async (interaction) => {
  const tid  = interaction.options.getString('tid', true);
  const textRaw = interaction.options.getString('text', true);

  const t = loadTournament(tid);
  if (!t) {
    return interaction.reply({ flags: EPHEMERAL, content: '❌ Tournament not found.' });
  }

  const playerId = interaction.user.id;
  const p = t.players[playerId];
  if (!p) {
    return interaction.reply({ flags: EPHEMERAL, content: '❌ You are not registered for this tournament.' });
  }
  if (p.deck?.locked) {
    return interaction.reply({ flags: EPHEMERAL, content: '🔒 Decklists are locked. Ask Chickies if you need a correction.' });
  }

  const text = normalizeDeckText(textRaw);
  if (!text) {
    return interaction.reply({ flags: EPHEMERAL, content: '❌ Paste your decklist text.' });
  }

  let parsed = parseDeck(text);
  if (!parsed || !Array.isArray(parsed.lines)) parsed = { lines: [], total: 0, invalid: [] };

  // Legality check (only when we have parsed lines)
  if (parsed.lines.length > 0) {
    const res = validateDeck(parsed.lines);
    if (!res.ok) {
      const bullets = res.errors.slice(0, 10).map(e => `• ${e}`).join('\n');
      return interaction.reply({
        flags: EPHEMERAL,
        content: [
          '❌ Your deck failed legality checks:',
          bullets,
          res.errors.length > 10 ? `…and ${res.errors.length - 10} more.` : '',
          res.rulesMeta?.effectiveDate ? `\n_(Rules effective ${res.rulesMeta.effectiveDate})_` : ''
        ].filter(Boolean).join('\n')
      });
    }
  }

  // Save submission as PENDING (text only)
  t.players[playerId].deck = {
    text,
    parsed: {
      total: parsed.total,
      lines: parsed.lines,
      invalid: parsed.invalid
    },
    submittedAt: new Date().toISOString(),
    locked: false,
    legal: parsed.lines.length === 0 ? null : true,
    status: 'pending'
  };
  saveTournament(tid, t);

  // Ephemeral confirmation to player
  let confirm = '✅ Decklist received and sent to Chickies for review.';
  if (parsed.invalid.length) {
    const sample = parsed.invalid.slice(0, 5).map(l => `• ${l}`).join('\n');
    confirm += `\n⚠️ I couldn’t parse ${parsed.invalid.length} line(s). Example:\n${sample}`;
  }
  confirm += '\nYou can resubmit until Chickies locks lists.';

  // Post to REVIEW CHANNEL with Approve/Reject buttons
  const reviewChannelId = process.env.DECK_REVIEW_CHANNEL_ID || t.meta?.deckReviewChannelId || t.meta?.channelId;
  if (reviewChannelId) {
    try {
      const guild = interaction.client.guilds.cache.get(t.meta.guildId);
      const channel = guild ? await guild.channels.fetch(reviewChannelId).catch(() => null) : null;

      if (!channel) {
        console.warn(`[deck] Review channel ${reviewChannelId} not found or no perms`);
      } else {
        const eb = new EmbedBuilder()
          .setTitle(`${t.meta.name || tid} — Deck Review`)
          .setDescription(`Player: <@${playerId}>`)
          .addFields(
            { name: 'Cards (parsed)', value: String(parsed.total || 0), inline: true },
            { name: 'Invalid lines', value: String(parsed.invalid?.length || 0), inline: true },
          )
          .setFooter({ text: `Submitted: ${interaction.user.tag} • ${playerId}` })
          .setTimestamp(new Date());

        // quick sample of parsed lines for TOs
        if (parsed.lines?.length) {
          const sampleParsed = parsed.lines.slice(0, 10).map(x => `${x.qty}x ${x.code}`).join('\n');
          if (sampleParsed) eb.addFields({ name: 'Parsed (sample)', value: '```\n' + sampleParsed + '\n```' });
        }

        // Text preview (always, since text-only)
        const shortPreview = '```\n' + (text.length > 700 ? text.slice(0, 700) + '\n…' : text) + '\n```';
        eb.addFields({ name: 'Text Preview', value: shortPreview });

        // Attach a .txt if very long
        const files = [];
        if (text.length > 1500) {
          const payload = `Player: ${interaction.user.tag} (${playerId})\nTournament: ${t.meta.name || tid}\n\n${text}`;
          const buffer = Buffer.from(payload, 'utf8');
          files.push(new AttachmentBuilder(buffer, { name: `deck_${tid}_${playerId}.txt` }));
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`deck_approve:${tid}:${playerId}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`deck_reject:${tid}:${playerId}`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger)
        );

        await channel.send({ embeds: [eb], components: [row], files });
      }
    } catch (err) {
      console.warn('Deck review channel post failed:', err);
      // don't block the user on this
    }
  }

  return interaction.reply({ flags: EPHEMERAL, content: confirm });
};
