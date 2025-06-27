import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const API_BASE = process.env.API_BASE_URL;

const commands = [
  new SlashCommandBuilder()
    .setName('completetile')
    .setDescription('Complete a tile by ID')
    .addIntegerOption(option => option.setName('id').setDescription('Tile ID').setRequired(true)),
  new SlashCommandBuilder()
    .setName('createmaze')
    .setDescription('Create a new maze')
    .addAttachmentOption(option => option.setName('savefile').setDescription('Optional save file (JSON)').setRequired(false)),
  new SlashCommandBuilder()
    .setName('fetchmaze')
    .setDescription('Fetch the current maze state'),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function registerCommands() {
  try {
    const appId = (await client.application?.fetch())?.id;
    await rest.put(
      Routes.applicationCommands(appId),
      { body: commands },
    );
    console.log('Slash commands registered.');
  } catch (error) {
    console.error(error);
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  registerCommands();
});

const completionInProgress = new Set();

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // Get the team name from the channel name
  let team = interaction.channel?.name;
  // If the channel name is not a valid team, try to get from a parent category or topic (optional, fallback)
  if (!team || team === 'general' || team === 'bot-commands') {
    // Optionally, you can set a default or error here
    team = interaction.guild?.name || 'default';
  }

  if (interaction.commandName === 'completetile') {
    const channelId = interaction.channelId;
    if (completionInProgress.has(channelId)) {
      await interaction.reply({ content: 'Please wait for the previous completion to finish in this channel.', ephemeral: true });
      return;
    }
    completionInProgress.add(channelId);
    try {
      await interaction.deferReply(); // Acknowledge immediately to avoid timeout
      const id = interaction.options.getInteger('id');
      // Pass team as a query parameter
      const res = await fetch(`${API_BASE}/tiles/complete/${id}?team=${encodeURIComponent(team)}`, { method: 'POST' });
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.startsWith('image/png')) {
        const buffer = Buffer.from(await res.arrayBuffer());
        // Check for boobytrap or chest message header (case-insensitive, log all headers for debug)
        let specialMsg = res.headers.get('x-boobytrap-message');
        if (!specialMsg) {
          specialMsg = res.headers.get('x-chest-message');
        }
        if (!specialMsg) {
          // Try alternate casing (node-fetch sometimes lowercases headers)
          specialMsg = res.headers.get('X-Boobytrap-Message') || res.headers.get('X-BOOBYTRAP-MESSAGE') || res.headers.get('X-Chest-Message') || res.headers.get('X-CHEST-MESSAGE');
        }
        if (!specialMsg) {
          // Debug: log all headers to help diagnose
          console.log('Headers received:', Object.fromEntries(res.headers.entries()));
        }
        await interaction.editReply({
          content: specialMsg ? specialMsg : `Tile ${id} completed! Here is the updated maze:`,
          files: [{ attachment: buffer, name: `maze-tile-${id}.png` }]
        });
      } else {
        // JSON response (already completed or error)
        let text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (err) {
          // If not valid JSON, show the raw text (likely HTML error page)
          // Try to extract a backend error message from HTML
          const match = text.match(/TypeError: ([^<]+)/);
          if (match) {
            await interaction.editReply({ content: `Backend error: ${match[1]}`, flags: 64 });
          } else {
            await interaction.editReply({ content: `Error: Unexpected response from server.\n${text.substring(0, 200)}`, flags: 64 });
          }
          return;
        }
        if (data.alreadyCompleted) {
          await interaction.editReply({ content: `Tile ${id} is already completed!`, flags: 64 });
        } else if (data.error) {
          await interaction.editReply({ content: `Error: ${data.error}`, flags: 64 });
        } else {
          await interaction.editReply({ content: `Unknown response from server.`, flags: 64 });
        }
      }
    } catch (e) {
      await interaction.editReply({ content: `Error: ${e.message}`, flags: 64 });
    } finally {
      completionInProgress.delete(channelId);
    }
  }

  if (interaction.commandName === 'createmaze') {
    await interaction.deferReply(); // Ensure this is the very first line
    try {
      // Pass team as a query parameter
      const saveFile = interaction.options.getAttachment('savefile');
      let res;
      if (saveFile) {
        // Download the file and send its content as saveData
        const fileRes = await fetch(saveFile.url);
        const saveText = await fileRes.text();
        let saveData;
        try {
          saveData = JSON.parse(saveText);
        } catch (err) {
          await interaction.editReply({ content: 'Invalid JSON in save file.', flags: 64 });
          return;
        }
        res = await fetch(`${API_BASE}/create?team=${encodeURIComponent(team)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ saveData })
        });
      } else {
        res = await fetch(`${API_BASE}/create?team=${encodeURIComponent(team)}`, { method: 'POST' });
      }
      if (!res.ok) {
        let errorMsg = 'Failed to create maze';
        let backendLog = '';
        try {
          const text = await res.text(); // Only read once!
          try {
            const data = JSON.parse(text);
            if (data && data.error) errorMsg = data.error;
            backendLog = data;
          } catch {
            backendLog = text;
          }
        } catch (err) {
          backendLog = err.message;
        }
        console.error('Backend error:', backendLog);
        await interaction.editReply({ content: `Error: ${errorMsg}`, flags: 64 });
        return;
      }
      await interaction.editReply('New maze created!');
    } catch (e) {
      await interaction.editReply({ content: `Error: ${e.message}`, flags: 64 });
    }
  }

  if (interaction.commandName === 'fetchmaze') {
    try {
      await interaction.deferReply();
      // Pass team as a query parameter
      const res = await fetch(`${API_BASE}/tiles?team=${encodeURIComponent(team)}`);
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await res.json();
        await interaction.editReply('Current maze state: ' + JSON.stringify(data));
      } else {
        // Not JSON, probably an error page
        const text = await res.text();
        await interaction.editReply({ content: `Error: Unexpected response from server.\n${text.substring(0, 200)}`, flags: 64 });
      }
    } catch (e) {
      await interaction.editReply({ content: `Error: ${e.message}`, flags: 64 });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
