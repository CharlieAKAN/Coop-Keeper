const { REST, Routes } = require('discord.js');
require('dotenv').config();
const fs = require('fs');

const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    
    // Only include files that export .data and .toJSON()
    if (command.data && typeof command.data.toJSON === 'function') {
        commands.push(command.data.toJSON());
    } else {
        console.warn(`[deploy] Skipping ${file} – not a valid slash command`);
    }
}

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('Registering slash commands...');
        
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );

        console.log('✅ Slash commands registered successfully!');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
})();
