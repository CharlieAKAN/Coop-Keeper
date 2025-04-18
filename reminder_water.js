// reminder_water.js  (CommonJS — single‑greeting edition)
const cron   = require('node-cron');
const OpenAI = require('openai').default;
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL  = process.env.OPENAI_MODEL || 'gpt-4o-mini';

module.exports = (client) => {
  cron.schedule(
    '* 12 * * *',                       // 6 :20 PM CT every day
    async () => {
      console.log('[hydration cron fired]', new Date().toISOString());

      try {
        // 1) random (non‑bot) member
        const guild  = await client.guilds.fetch(process.env.GUILD_ID);
        const humans = (await guild.members.fetch()).filter(m => !m.user.bot);
        const member = humans.random();
        if (!member) return;

        // 2) fallback if OpenAI coughs
        let line = 'time to splash some H₂O into that heroic mouth! 💧';

        // 3) grab cheeky one‑liner (no greeting)
        try {
          const res = await openai.chat.completions.create({
            model: MODEL,
            temperature: 1.0,
            max_tokens: 40,
            messages: [
              {
                role: 'system',
                content: `
You are an over‑caffeinated yet cheeky hype friend.
Write ONE playful, dynamic sentence (≤18 words) reminding someone to drink water.
⚠️ Do NOT greet or mention the user; they'll already be tagged.
Optional onomatopoeia like splash or gulp welcome.
End with at least one water emoji (💦,💧,🚰).
                `.trim(),
              },
              { role: 'user', content: 'Give me today’s reminder!' },
            ],
          });
          line = res.choices[0].message.content.trim();
        } catch (apiErr) {
          console.warn('OpenAI hiccup – using fallback line.', apiErr);
        }

        // 4) send it (single mention)
        const channel = await client.channels.fetch(
          process.env.WATER_LEADERBOARD_CHANNEL_ID
        );
        if (!channel) return;

        await channel.send(
          `${member} — ${line}\n\nUse </water:1358968131397091409> to log your slurps!`
        );
      } catch (err) {
        console.error('Daily water reminder failed:', err);
      }
    },
    { scheduled: true, timezone: 'America/Chicago' }
  );
};
