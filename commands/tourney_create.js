// commands/tourney_create.js
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const { upsertTournament } = require('../lib/store');
const { requireAdmin } = require('../lib/auth');

const builder = new SlashCommandBuilder()
  .setName('tourney_create')
  .setDescription('Create a new tournament (file-based)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(o=>o.setName('tid').setDescription('Tournament ID').setRequired(true))
  .addStringOption(o=>o.setName('name').setDescription('Display name').setRequired(true))
  .addStringOption(o=>o.setName('structure').setDescription('swiss | single_elim | swiss+cut').setRequired(true)
    .addChoices(
      { name:'swiss', value:'swiss' },
      { name:'single_elim', value:'single_elim' },
      { name:'swiss+cut', value:'swiss+cut' }
    ))
  .addIntegerOption(o=>o.setName('bestof').setDescription('1 or 3').setRequired(true))
  .addIntegerOption(o=>o.setName('roundtime').setDescription('Minutes per round').setRequired(true))
  .addIntegerOption(o=>o.setName('cap').setDescription('Max players').setRequired(true))
  .addBooleanOption(o=>o.setName('paid').setDescription('Require payment?').setRequired(true))
  .addIntegerOption(o=>o.setName('fee').setDescription('Entry fee in cents').setRequired(false))

  // ─── NEW: overtime options ────────────────────────────────────────────────
  .addStringOption(o=>o
    .setName('overtime_mode')
    .setDescription('How to resolve unreported matches after time')
    .setRequired(false)
    .addChoices(
      { name:'none (straight draw/TO decision)', value:'none' },
      { name:'extra_time (add minutes)',        value:'extra_time' },
      { name:'extra_turns (N additional turns)',value:'extra_turns' },
      { name:'sudden_death (first life/trigger etc.)', value:'sudden_death' }
    )
  )
  .addIntegerOption(o=>o
    .setName('ot_minutes')
    .setDescription('Overtime minutes (only if overtime_mode=extra_time)')
    .setRequired(false)
    .setMinValue(1).setMaxValue(30)
  )
  .addIntegerOption(o=>o
    .setName('ot_turns')
    .setDescription('Overtime turns per match (only if overtime_mode=extra_turns)')
    .setRequired(false)
    .setMinValue(1).setMaxValue(10)
  );

// Guild-only: new API if available, else fallback
if (typeof builder.setContexts === 'function') builder.setContexts(InteractionContextType.Guild);
else builder.setDMPermission(false);

module.exports.data = builder;

module.exports.execute = async (interaction) => {
  if (!(await requireAdmin(interaction))) return;

  const tid        = interaction.options.getString('tid', true);
  const name       = interaction.options.getString('name', true);
  const structure  = interaction.options.getString('structure', true);
  const bestOf     = interaction.options.getInteger('bestof', true);
  const roundTime  = interaction.options.getInteger('roundtime', true);
  const cap        = interaction.options.getInteger('cap', true);
  const paidReq    = interaction.options.getBoolean('paid', true);
  const fee        = interaction.options.getInteger('fee') ?? 0;

  // NEW overtime pulls
  const overtimeMode = interaction.options.getString('overtime_mode') ?? 'none';
  const otMinutes    = interaction.options.getInteger('ot_minutes') ?? null;
  const otTurns      = interaction.options.getInteger('ot_turns') ?? null;

  // Basic validation
  if (paidReq && fee <= 0) {
    return interaction.reply({ ephemeral:true, content:'If paid=true, set a positive fee (in cents).' });
  }

  // Overtime validation matrix
  if (overtimeMode === 'extra_time' && !otMinutes) {
    return interaction.reply({ ephemeral:true, content:'Set `ot_minutes` when overtime_mode=extra_time.' });
  }
  if (overtimeMode !== 'extra_time' && otMinutes) {
    return interaction.reply({ ephemeral:true, content:'`ot_minutes` is only valid when overtime_mode=extra_time.' });
  }
  if (overtimeMode === 'extra_turns' && !otTurns) {
    return interaction.reply({ ephemeral:true, content:'Set `ot_turns` when overtime_mode=extra_turns.' });
  }
  if (overtimeMode !== 'extra_turns' && otTurns) {
    return interaction.reply({ ephemeral:true, content:'`ot_turns` is only valid when overtime_mode=extra_turns.' });
  }

  upsertTournament({
    tid, name, guildId: interaction.guildId, channelId: interaction.channelId,
    structure, bestOf, roundTimeMins: roundTime, maxPlayers: cap,
    paidRequired: paidReq, entryFeeCents: fee, currency: 'usd',
    status: 'registration', currentRound: 0, requireDecklist: false,
    tables: { mode: 'virtual', count: 999, labelMap: {} },
    createdAt: new Date().toISOString(),

    // ─── NEW: store overtime config in meta ────────────────────────────────
    overtime: {
      mode: overtimeMode,           // 'none' | 'extra_time' | 'extra_turns' | 'sudden_death'
      minutes: overtimeMode === 'extra_time'  ? otMinutes : null,
      turns:   overtimeMode === 'extra_turns' ? otTurns   : null
    }
  });

  // Build a short human summary for the confirm
  const otSummary =
    overtimeMode === 'none'         ? 'No overtime.' :
    overtimeMode === 'extra_time'   ? `Overtime: +${otMinutes} min.` :
    overtimeMode === 'extra_turns'  ? `Overtime: +${otTurns} turns.` :
    'Overtime: sudden death.';

  return interaction.reply({
    ephemeral: true,
    content: `✅ **${name}** created (\`${tid}\`). Registration is open.\n${otSummary}`
  });
};
