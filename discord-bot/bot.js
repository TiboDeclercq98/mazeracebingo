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
    .setDescription('Create a new maze'),
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

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'completetile') {
    const id = interaction.options.getInteger('id');
    try {
      const res = await fetch(`${API_BASE}/tiles/complete/${id}`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to complete tile');
      await interaction.reply(`Tile ${id} completed!`);
    } catch (e) {
      await interaction.reply({ content: `Error: ${e.message}`, ephemeral: true });
    }
  }

  if (interaction.commandName === 'createmaze') {
    try {
      const res = await fetch(`${API_BASE}/create`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to create maze');
      await interaction.reply('New maze created!');
    } catch (e) {
      await interaction.reply({ content: `Error: ${e.message}`, ephemeral: true });
    }
  }

  if (interaction.commandName === 'fetchmaze') {
    try {
      const res = await fetch(`${API_BASE}/tiles`);
      const data = await res.json();
      await interaction.reply('Current maze state: ' + JSON.stringify(data));
    } catch (e) {
      await interaction.reply({ content: `Error: ${e.message}`, ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
