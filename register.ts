import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { cfg } from './config.js';

const commands = [
  new SlashCommandBuilder().setName('raffle').setDescription('Open Vanguard raffle admin'),
  new SlashCommandBuilder().setName('cooldown').setDescription('Show your loot cooldowns'),
  new SlashCommandBuilder().setName('loothistory').setDescription('Show the last 3 raffles'),
  new SlashCommandBuilder().setName('loot-screenshot').setDescription('Import loot from a screenshot')
    .addAttachmentOption(o => o.setName('image').setDescription('Loot screenshot').setRequired(true)),
].map(c => c.toJSON());

export async function registerCommands(){
  const rest = new REST({version:'10'}).setToken(cfg.token);
  await rest.put(Routes.applicationGuildCommands(cfg.clientId, cfg.guildId), { body: commands });
}
