// commands/threads_purge.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require('discord.js');

const EPHEMERAL = (MessageFlags && MessageFlags.Ephemeral) ? MessageFlags.Ephemeral : 64;

module.exports.data = new SlashCommandBuilder()
  .setName('threads_purge')
  .setDescription('Admin: delete ALL threads under a parent channel (defaults to THREADS_PARENT_CHANNEL_ID)')
  .addChannelOption(o =>
    o.setName('parent')
     .setDescription('Parent text channel to purge threads from (defaults to env THREADS_PARENT_CHANNEL_ID)')
     .addChannelTypes(ChannelType.GuildText)
     .setRequired(false)
  )
  .addBooleanOption(o =>
    o.setName('include_current')
     .setDescription('Also delete the thread you ran this in (if applicable)')
     .setRequired(false)
  )
  .addBooleanOption(o =>
    o.setName('confirm')
     .setDescription('Must be true to actually delete')
     .setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads);

module.exports.execute = async (interaction) => {
  // Defer immediately to avoid "Unknown interaction"
  await interaction.deferReply({ flags: EPHEMERAL }).catch(() => {});

  // extra guard: require ManageThreads OR Administrator
  const can =
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageThreads) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  if (!can) {
    return interaction.editReply('🚫 You need **Manage Threads** to run this.');
  }

  // Parent resolution
  const parentOpt = interaction.options.getChannel('parent', false);
  const parentId = parentOpt?.id || process.env.THREADS_PARENT_CHANNEL_ID;
  if (!parentId) {
    return interaction.editReply('❌ No parent provided and THREADS_PARENT_CHANNEL_ID is not set.');
  }

  const parent = await interaction.client.channels.fetch(parentId).catch(() => null);
  if (!parent) {
    return interaction.editReply('❌ Could not fetch the parent channel.');
  }
  if (parent.type !== ChannelType.GuildText) {
    return interaction.editReply('❌ Parent must be a **Text** channel (private threads live there).');
  }

  // --- Fetch active + archived threads under this parent ---
  const activeRes = await parent.threads.fetchActive().catch(() => null);
  const active = activeRes?.threads ?? new Map();

  const archivedPubRes = await parent.threads
    .fetchArchived({ type: 'public', fetchAll: true })
    .catch(() => null);
  const archivedPublic = archivedPubRes?.threads ?? new Map();

  const archivedPrivRes = await parent.threads
    .fetchArchived({ type: 'private', fetchAll: true })
    .catch(() => null);
  const archivedPrivate = archivedPrivRes?.threads ?? new Map();

  // Merge + filter by parent (paranoia)
  const allThreadsMap = new Map();
  for (const t of active.values()) if (t.parentId === parent.id) allThreadsMap.set(t.id, t);
  for (const t of archivedPublic.values()) if (t.parentId === parent.id) allThreadsMap.set(t.id, t);
  for (const t of archivedPrivate.values()) if (t.parentId === parent.id) allThreadsMap.set(t.id, t);

  let threads = [...allThreadsMap.values()];

  // By default, do NOT delete the thread where the command was run (prevents Unknown Channel on reply)
  const includeCurrent = interaction.options.getBoolean('include_current') === true;
  if (!includeCurrent && interaction.channel?.isThread?.()) {
    threads = threads.filter(t => t.id !== interaction.channelId);
  }

  const count = threads.length;
  if (count === 0) {
    return interaction.editReply(`✅ No threads found under <#${parent.id}>.` + (includeCurrent ? '' : ' (current thread excluded)'));
  }

  const confirm = interaction.options.getBoolean('confirm') === true;

  if (!confirm) {
    const preview = threads.slice(0, 10).map(t => `• ${t.name} (${t.id})`).join('\n');
    const more = count > 10 ? `\n…and **${count - 10}** more.` : '';
    return interaction.editReply(
      `⚠️ This will **DELETE ${count} threads** under <#${parent.id}>${includeCurrent ? '' : ' (current thread excluded)'}.\n` +
      `Run \`/threads_purge\` again with **confirm: true** to proceed.\n\n` +
      `Preview:\n${preview}${more}`
    );
  }

  // Delete sequentially to be gentle on rate limits
  let deleted = 0;
  let failed = 0;
  for (const thr of threads) {
    try {
      await thr.delete(`threads_purge by ${interaction.user.tag}`);
      deleted++;
      // tiny delay to avoid hitting the hammer if there are LOTS of threads
      await new Promise(r => setTimeout(r, 150));
    } catch {
      failed++;
    }
  }

  // If user asked to include_current and we're in a thread under the same parent, try deleting AFTER we reported
  if (includeCurrent && interaction.channel?.isThread?.() && interaction.channel?.parentId === parent.id) {
    // Tell the user in DM-less context that we’re deleting this thread — we can’t, so just finish.
    // We won't attempt to delete the current thread here because it would sever our reply context.
    // If you *really* want to delete the current thread automatically, we need to move the response elsewhere first.
  }

  return interaction.editReply(`🧹 Done. Deleted **${deleted}** thread(s) under <#${parent.id}>.` + (failed ? ` Failed: **${failed}**.` : ''));
};
