// reminder_water.js  (Energy‑Drink Gremlin edition)
import cron from 'node-cron';
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-nano';

export default (client) => {
  cron.schedule(
    '0 12 * * *',
    async () => {
      try {
        // 1) random (non‑bot) member
        const guild   = await client.guilds.fetch(process.env.GUILD_ID);
        const humans  = (await guild.members.fetch()).filter(m => !m.user.bot);
        const member  = humans.random();
        if (!member) return;

        // 2) generate one sentence of hyper‑enthusiasm
        let line = 'Bounce up and chug that H₂O, legend! 💦'; // fallback
        try {
          const { choices } = await openai.chat.completions.create({
            model: MODEL,
            max_tokens: 30,
            temperature: 0.95,
            messages: [
              {
                role: 'system',
                content: `
Speak like an over‑caffeinated hype friend who thinks hydration is a thrill sport:
• one sentence, max 18 words
• ends with at least one water emoji
• big energy, exclamation points, playful wording
                `.trim(),
              },
              { role: 'user', content: 'Give me today’s reminder!' },
            ],
          });
          line = choices[0].message.content.trim();
        } catch (apiErr) {
          console.warn('OpenAI hiccup, using fallback line.', apiErr);
        }

        // 3) send it
        const channel = await client.channels.fetch(
          process.env.WATER_LEADERBOARD_CHANNEL_ID
        );
        if (!channel) return;

        await channel.send(
          `Hey ${member}, ${line}\nUse </water:1358968131397091409> to log your slurps!`
        );
      } catch (err) {
        console.error('Daily water reminder failed:', err);
      }
    },
    {
      scheduled: true,
      timezone: 'America/Chicago',
    }
  );
};
