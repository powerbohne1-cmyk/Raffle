import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';

export const colorHex: Record<string, number> = {
  gold: 0xF2C94C,
  purple: 0x9B51E0,
  blue: 0x2F80ED,
  red: 0xEB5757,
};
export const colorEmoji: Record<string, string> = { gold:'🟨', purple:'🟪', blue:'🟦', red:'🟥' };

export function adminHome() {
  const embed = new EmbedBuilder().setTitle('🎁 Vanguard Loot Raffle').setDescription('Wähle einfach aus, was du machen möchtest.');
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('admin:create').setLabel('Create Raffle').setEmoji('➕').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin:active').setLabel('Active Raffle').setEmoji('🎯').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin:loot').setLabel('Loot Settings').setEmoji('📦').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('admin:history').setLabel('History').setEmoji('📜').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin:cooldowns').setLabel('Cooldowns').setEmoji('⏱️').setStyle(ButtonStyle.Secondary),
  );
  return { embeds:[embed], components:[row1,row2] };
}

export function publicRaffleEmbed(r:any, loot:any[], entries=0) {
  const endUnix = Math.floor(new Date(r.ends_at).getTime()/1000);
  const lines = loot.map((x:any) => {
    const c = x.loot_items?.loot_classes;
    const em = colorEmoji[c?.color] ?? '⬜';
    return `${em} **${x.loot_items?.name ?? 'Loot'} ×${x.quantity}**\n${c?.name ?? 'No class'} · ${c?.cooldown_hours ?? 0}h cooldown`;
  });
  return new EmbedBuilder()
    .setTitle(`🎁 ${r.title}`)
    .setDescription([r.intro_text || '', '', ...lines, '', `⏳ **Entries close <t:${endUnix}:R>**`, `👥 ${entries} player(s) entered`, '', r.closing_text || ''].join('\n'));
}

export function playerButtons(raffleId:string, closed=false) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`player:select:${raffleId}`).setLabel('Select Loot').setEmoji('🎁').setStyle(ButtonStyle.Primary).setDisabled(closed),
    new ButtonBuilder().setCustomId(`player:my:${raffleId}`).setLabel('My Selection').setEmoji('✅').setStyle(ButtonStyle.Secondary).setDisabled(closed),
  )];
}

export function lootSelect(customId:string, options:any[], selected:string[] = []) {
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Choose all loot you want')
    .setMinValues(0)
    .setMaxValues(Math.max(1, Math.min(25, options.length)))
    .addOptions(options.slice(0,25).map(x => ({
      label: x.name.slice(0,100),
      value: x.id,
      description: `${x.loot_classes?.name ?? 'No class'} · ${x.loot_classes?.cooldown_hours ?? 0}h`,
      emoji: colorEmoji[x.loot_classes?.color] ?? '⬜',
      default: selected.includes(x.id),
    })));
}
