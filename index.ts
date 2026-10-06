import 'dotenv/config';
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder,
  GatewayIntentBits, Interaction, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle
} from 'discord.js';
import OpenAI from 'openai';
import { assertConfig, cfg } from './config.js';
import { db, activeLoot } from './db.js';
import { adminHome, colorEmoji, lootSelect, playerButtons, publicRaffleEmbed } from './ui.js';
import { registerCommands } from './register.js';

assertConfig();
const client = new Client({ intents:[GatewayIntentBits.Guilds] });
const timers = new Map<string, NodeJS.Timeout[]>();

function isAdmin(i:any){
  return i.member?.roles?.cache?.has?.(cfg.adminRoleId) || i.memberPermissions?.has?.(PermissionFlagsBits.Administrator);
}
function shuffle<T>(a:T[]){ return [...a].sort(() => Math.random() - 0.5); }

async function getRaffle(id:string){
  const {data} = await db.from('raffles').select('*').eq('id', id).single(); return data;
}
async function getRaffleLoot(id:string){
  const {data} = await db.from('raffle_loot').select('id,quantity,loot_item_id,loot_items(id,name,emoji,loot_class_id,loot_classes(id,name,color,cooldown_hours))').eq('raffle_id',id); return data ?? [];
}
async function getEntriesCount(id:string){
  const {count} = await db.from('raffle_entries').select('discord_user_id',{count:'exact',head:true}).eq('raffle_id',id); return count ?? 0;
}
async function updatePublic(raffleId:string){
  const r = await getRaffle(raffleId); if(!r?.message_id) return;
  const channel:any = await client.channels.fetch(r.channel_id); if(!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(r.message_id).catch(()=>null); if(!message) return;
  await message.edit({embeds:[publicRaffleEmbed(r, await getRaffleLoot(raffleId), await getEntriesCount(raffleId))], components:playerButtons(raffleId,r.status!=='open')});
}
async function scheduleRaffle(raffleId:string){
  const r = await getRaffle(raffleId); if(!r || r.status!=='open') return;
  timers.get(raffleId)?.forEach(clearTimeout);
  const ms = new Date(r.ends_at).getTime()-Date.now();
  const list:NodeJS.Timeout[]=[];
  if(ms>60000){
    list.push(setTimeout(async()=>{
      const rr=await getRaffle(raffleId); if(rr?.status!=='open') return;
      const ch:any=await client.channels.fetch(rr.channel_id);
      await ch?.send({content:'@everyone ⏰ **Nur noch 1 Minute!** Das MI Loot Raffle schließt gleich. Wer noch teilnehmen will, bitte jetzt Loot auswählen.',allowedMentions:{parse:['everyone']}});
    }, ms-60000));
  }
  if(ms>0){
    list.push(setTimeout(async()=>{
      await db.from('raffles').update({status:'closed'}).eq('id',raffleId).eq('status','open');
      await updatePublic(raffleId);
      const rr=await getRaffle(raffleId); const ch:any=await client.channels.fetch(rr.channel_id);
      const row=new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`admin:spin:${raffleId}`).setLabel('Spin Raffle').setEmoji('🎡').setStyle(ButtonStyle.Success));
      await ch?.send({content:'🔒 **Entries closed.** Admin can now spin the complete raffle.',components:[row]});
    },ms));
  }
  timers.set(raffleId,list);
}

async function openCreateModal(i:any){
  const modal=new ModalBuilder().setCustomId('modal:create').setTitle('Create Raffle');
  const title=new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setValue('Monster Invasion Loot');
  const intro=new TextInputBuilder().setCustomId('intro').setLabel('Start text').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('Message shown above the loot');
  const closing=new TextInputBuilder().setCustomId('closing').setLabel('Closing text under the loot').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('e.g. Good luck everyone!');
  const mins=new TextInputBuilder().setCustomId('minutes').setLabel('Entry timer in minutes').setStyle(TextInputStyle.Short).setRequired(true).setValue('30');
  modal.addComponents(...[title,intro,closing,mins].map(x=>new ActionRowBuilder<TextInputBuilder>().addComponents(x)));
  await i.showModal(modal);
}

async function showDraftLoot(i:any, raffleId:string){
  const items:any[]=await activeLoot();
  const {data:selected}=await db.from('raffle_loot').select('loot_item_id').eq('raffle_id',raffleId);
  const selectedIds=(selected??[]).map((x:any)=>x.loot_item_id);
  const menu=lootSelect(`draft:loot:${raffleId}`,items,selectedIds);
  const row1=new ActionRowBuilder<any>().addComponents(menu);
  const row2=new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`draft:qty:${raffleId}`).setLabel('Set Quantities').setEmoji('➕').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`draft:start:${raffleId}`).setLabel('Start Raffle').setEmoji('🚀').setStyle(ButtonStyle.Success)
  );
  await i.reply({content:'📦 **Select saved loot** (first 25 shown; add sort/filter later if your catalog grows beyond 25).',components:[row1,row2],ephemeral:true});
}

async function startRaffle(raffleId:string, i:any){
  const r=await getRaffle(raffleId); const loot=await getRaffleLoot(raffleId);
  if(!loot.length) return i.reply({content:'Add at least one loot item first.',ephemeral:true});
  const channel:any=await client.channels.fetch(cfg.raffleChannelId);
  const endsAt=new Date(r.ends_at);
  const msg=await channel.send({
    content:'@everyone 🎁 **A new Monster Invasion Loot Raffle has started!** Choose your loot before the timer ends.',
    embeds:[publicRaffleEmbed({...r,status:'open'},loot,0)],
    components:playerButtons(raffleId,false),
    allowedMentions:{parse:['everyone']}
  });
  await db.from('raffles').update({status:'open',channel_id:channel.id,message_id:msg.id,starts_at:new Date().toISOString()}).eq('id',raffleId);
  await scheduleRaffle(raffleId);
  await i.reply({content:`✅ Raffle started in <#${channel.id}>. Ends <t:${Math.floor(endsAt.getTime()/1000)}:R>.`,ephemeral:true});
}

async function spinRaffle(raffleId:string,i:any){
  const r=await getRaffle(raffleId); if(!r || !['closed','open'].includes(r.status)) return i.reply({content:'Raffle cannot be spun.',ephemeral:true});
  const loot:any[]=await getRaffleLoot(raffleId);
  const results:any[]=[];
  const wonClasses=new Map<string,Set<string>>();
  for(const rl of loot){
    const item=rl.loot_items; const cls=item?.loot_classes;
    const {data:entries}=await db.from('raffle_entries').select('*').eq('raffle_id',raffleId).eq('loot_item_id',rl.loot_item_id);
    const eligible:any[]=[];
    for(const e of entries??[]){
      if(cls?.id){
        const {data:cd}=await db.from('player_cooldowns').select('*').eq('discord_user_id',e.discord_user_id).eq('loot_class_id',cls.id).maybeSingle();
        if(cd && new Date(cd.cooldown_until).getTime()>Date.now()) continue;
        if(wonClasses.get(e.discord_user_id)?.has(cls.id)) continue;
      }
      eligible.push(e);
    }
    const winners=shuffle(eligible).slice(0,Math.min(rl.quantity,eligible.length));
    for(const w of winners){
      const {data:win}=await db.from('raffle_winners').insert({raffle_id:raffleId,loot_item_id:rl.loot_item_id,loot_class_id:cls?.id,discord_user_id:w.discord_user_id,discord_display_name:w.discord_display_name}).select().single();
      if(cls?.id){
        const set=wonClasses.get(w.discord_user_id)??new Set<string>(); set.add(cls.id); wonClasses.set(w.discord_user_id,set);
        if((cls.cooldown_hours??0)>0){
          const until=new Date(Date.now()+cls.cooldown_hours*3600_000).toISOString();
          await db.from('player_cooldowns').upsert({discord_user_id:w.discord_user_id,loot_class_id:cls.id,cooldown_until:until,source_winner_id:win?.id});
        }
      }
    }
    results.push({item,quantity:rl.quantity,winners});
  }
  await db.from('raffles').update({status:'spun'}).eq('id',raffleId);
  const lines=results.flatMap(x=>{
    const cls=x.item?.loot_classes; const em=colorEmoji[cls?.color]??'⬜';
    const wins=x.winners.length?x.winners.map((w:any)=>`👑 <@${w.discord_user_id}>`).join('\n'):'No eligible winner';
    return [`${em} **${x.item.name} ×${x.quantity}**`,wins,''];
  });
  const embed=new EmbedBuilder().setTitle('🏆 Raffle Results').setDescription(lines.join('\n'));
  const ch:any=await client.channels.fetch(r.channel_id); await ch?.send({embeds:[embed]});
  await i.reply({content:'✅ Results saved. Website history can read this raffle immediately.',ephemeral:true});
}

client.on('interactionCreate',async(i:Interaction)=>{
  try{
    if(i.isChatInputCommand()){
      if(i.commandName==='raffle'){
        if(!isAdmin(i)) return i.reply({content:'Admin role required.',ephemeral:true});
        return i.reply({...adminHome(),ephemeral:true});
      }
      if(i.commandName==='cooldown'){
        const {data}=await db.from('player_cooldowns').select('cooldown_until,loot_classes(name,color)').eq('discord_user_id',i.user.id);
        const active=(data??[]).filter((x:any)=>new Date(x.cooldown_until).getTime()>Date.now());
        const desc=active.length?active.map((x:any)=>`${colorEmoji[x.loot_classes?.color]??'⬜'} **${x.loot_classes?.name}** — <t:${Math.floor(new Date(x.cooldown_until).getTime()/1000)}:R>`).join('\n'):'✅ No active cooldowns.';
        return i.reply({embeds:[new EmbedBuilder().setTitle('⏱️ Your Cooldowns').setDescription(desc)],ephemeral:true});
      }
      if(i.commandName==='loothistory'){
        const {data:rs}=await db.from('raffles').select('id,title,starts_at').eq('status','spun').order('starts_at',{ascending:false}).limit(3);
        const parts:string[]=[];
        for(const r of rs??[]){
          const {data:w}=await db.from('raffle_winners').select('discord_display_name,loot_items(name,loot_classes(color))').eq('raffle_id',r.id);
          parts.push(`**MI ${new Date(r.starts_at).toLocaleString('de-DE')}**\n${(w??[]).map((x:any)=>`${colorEmoji[x.loot_items?.loot_classes?.color]??'⬜'} ${x.loot_items?.name} — ${x.discord_display_name}`).join('\n')||'No winners'}`);
        }
        return i.reply({embeds:[new EmbedBuilder().setTitle('📜 Last 3 Raffles').setDescription(parts.join('\n\n')||'No raffles yet.')],ephemeral:true});
      }
      if(i.commandName==='loot-screenshot'){
        if(!isAdmin(i)) return i.reply({content:'Admin role required.',ephemeral:true});
        const image=i.options.getAttachment('image',true);
        if(!cfg.openaiKey) return i.reply({content:'📸 Screenshot received. Set `OPENAI_API_KEY` to enable automatic loot recognition.',ephemeral:true});
        await i.deferReply({ephemeral:true});
        const catalog:any[]=await activeLoot();
        const ai=new OpenAI({apiKey:cfg.openaiKey});
        const response=await ai.responses.create({
          model:'gpt-6-luna',
          input:[{role:'user',content:[
            {type:'input_text',text:`Read this game loot screenshot. Match visible loot to this catalog: ${catalog.map(x=>x.name).join(', ')}. Return concise JSON array only: [{"name":"...","quantity":1}]`},
            {type:'input_image',image_url:image.url,detail:'high'}
          ]}]
        } as any);
        return i.editReply(`📸 Detected loot proposal:\n\n\`\`\`json\n${response.output_text.slice(0,1600)}\n\`\`\`\nReview before adding it to a raffle.`);
      }
    }

    if(i.isButton()){
      if(i.customId==='admin:create'){ if(!isAdmin(i)) return; return openCreateModal(i); }
      if(i.customId==='admin:history'){ return i.reply({content:'Use `/loothistory` to show the last 3 raffles.',ephemeral:true}); }
      if(i.customId==='admin:cooldowns'){ return i.reply({content:'Use `/cooldown` for your status. Admin player lookup can be added next.',ephemeral:true}); }
      if(i.customId==='admin:loot'){ return i.reply({content:'📦 Loot Catalog is stored in Supabase. Use the admin web/database for initial setup; Discord add/edit buttons are scaffolded for the next iteration.',ephemeral:true}); }
      if(i.customId==='admin:active'){
        const {data:r}=await db.from('raffles').select('*').in('status',['open','closed']).order('created_at',{ascending:false}).limit(1).maybeSingle();
        return i.reply({content:r?`🎯 Active/latest raffle: **${r.title}** — ${r.status} — ends <t:${Math.floor(new Date(r.ends_at).getTime()/1000)}:R>`:'No active raffle.',ephemeral:true});
      }
      if(i.customId.startsWith('draft:start:')) return startRaffle(i.customId.split(':')[2],i);
      if(i.customId.startsWith('admin:spin:')){ if(!isAdmin(i)) return; return spinRaffle(i.customId.split(':')[2],i); }
      if(i.customId.startsWith('player:select:')){
        const raffleId=i.customId.split(':')[2]; const r=await getRaffle(raffleId);
        if(!r||r.status!=='open') return i.reply({content:'This raffle is closed.',ephemeral:true});
        const rl:any[]=await getRaffleLoot(raffleId); const ids=rl.map(x=>x.loot_item_id);
        const items:any[]=await activeLoot(); const allowed=items.filter(x=>ids.includes(x.id));
        const {data:mine}=await db.from('raffle_entries').select('loot_item_id').eq('raffle_id',raffleId).eq('discord_user_id',i.user.id);
        const row=new ActionRowBuilder<any>().addComponents(lootSelect(`player:choose:${raffleId}`,allowed,(mine??[]).map((x:any)=>x.loot_item_id)));
        return i.reply({content:'🎁 Select every loot item you want to be eligible for. Cooldowns are checked again when spinning.',components:[row],ephemeral:true});
      }
      if(i.customId.startsWith('player:my:')){
        const id=i.customId.split(':')[2]; const {data}=await db.from('raffle_entries').select('loot_items(name,loot_classes(color))').eq('raffle_id',id).eq('discord_user_id',i.user.id);
        return i.reply({content:(data??[]).length?(data??[]).map((x:any)=>`${colorEmoji[x.loot_items?.loot_classes?.color]??'⬜'} ${x.loot_items?.name}`).join('\n'):'No loot selected yet.',ephemeral:true});
      }
      if(i.customId.startsWith('draft:qty:')){
        const id=i.customId.split(':')[2]; const rl:any[]=await getRaffleLoot(id);
        const rows=rl.slice(0,5).map(x=>new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`qty:minus:${x.id}:${id}`).setLabel('−').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('noop').setLabel(`${x.loot_items?.name}: ${x.quantity}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId(`qty:plus:${x.id}:${id}`).setLabel('+').setStyle(ButtonStyle.Secondary)
        ));
        return i.reply({content:'➕ Set quantities (first 5 selected items shown at once):',components:rows,ephemeral:true});
      }
      if(i.customId.startsWith('qty:')){
        const [_,dir,rowId,raffleId]=i.customId.split(':'); const {data:row}=await db.from('raffle_loot').select('quantity').eq('id',rowId).single();
        const next=Math.max(1,Math.min(99,(row?.quantity??1)+(dir==='plus'?1:-1)));
        await db.from('raffle_loot').update({quantity:next}).eq('id',rowId);
        return i.update({content:`Quantity updated to ${next}. Close this panel and use Set Quantities again for a refreshed view.`,components:[]});
      }
    }

    if(i.isModalSubmit() && i.customId==='modal:create'){
      const title=i.fields.getTextInputValue('title');
      const intro=i.fields.getTextInputValue('intro');
      const closing=i.fields.getTextInputValue('closing');
      const mins=Math.max(1,Math.min(10080,Number(i.fields.getTextInputValue('minutes'))||30));
      const {data:r,error}=await db.from('raffles').insert({guild_id:cfg.guildId,channel_id:cfg.raffleChannelId,created_by:i.user.id,title,intro_text:intro,closing_text:closing,ends_at:new Date(Date.now()+mins*60000).toISOString(),status:'draft'}).select().single();
      if(error) throw error;
      return showDraftLoot(i,r.id);
    }

    if(i.isStringSelectMenu()){
      if(i.customId.startsWith('draft:loot:')){
        const raffleId=i.customId.split(':')[2];
        await db.from('raffle_loot').delete().eq('raffle_id',raffleId);
        if(i.values.length) await db.from('raffle_loot').insert(i.values.map(id=>({raffle_id:raffleId,loot_item_id:id,quantity:1})));
        return i.reply({content:`✅ ${i.values.length} loot item(s) selected.`,ephemeral:true});
      }
      if(i.customId.startsWith('player:choose:')){
        const raffleId=i.customId.split(':')[2]; const r=await getRaffle(raffleId);
        if(!r||r.status!=='open') return i.reply({content:'Raffle is closed.',ephemeral:true});
        await db.from('raffle_entries').delete().eq('raffle_id',raffleId).eq('discord_user_id',i.user.id);
        const display=(i.member as any)?.displayName ?? i.user.globalName ?? i.user.username;
        if(i.values.length) await db.from('raffle_entries').insert(i.values.map(id=>({raffle_id:raffleId,loot_item_id:id,discord_user_id:i.user.id,discord_display_name:display})));
        await updatePublic(raffleId);
        return i.reply({content:`✅ Selection saved: ${i.values.length} loot item(s).`,ephemeral:true});
      }
    }
  } catch(e:any){
    console.error(e);
    if(i.isRepliable()){
      const payload={content:`Error: ${e?.message??'Unknown error'}`,ephemeral:true};
      if(i.replied||i.deferred) await i.followUp(payload).catch(()=>{}); else await i.reply(payload).catch(()=>{});
    }
  }
});

client.once('ready',async()=>{
  console.log(`Logged in as ${client.user?.tag}`);
  const {data}=await db.from('raffles').select('id').eq('status','open').gt('ends_at',new Date().toISOString());
  for(const r of data??[]) scheduleRaffle(r.id);
});

await registerCommands();
await client.login(cfg.token);
