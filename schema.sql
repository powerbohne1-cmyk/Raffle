create extension if not exists pgcrypto;

create table if not exists loot_classes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null check (color in ('gold','purple','blue','red')),
  cooldown_hours integer not null default 0 check (cooldown_hours >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists loot_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  loot_class_id uuid references loot_classes(id),
  emoji text,
  image_url text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists raffles (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  channel_id text not null,
  message_id text,
  created_by text not null,
  title text not null,
  intro_text text,
  closing_text text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft','open','closed','spun','cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists raffle_loot (
  id uuid primary key default gen_random_uuid(),
  raffle_id uuid not null references raffles(id) on delete cascade,
  loot_item_id uuid not null references loot_items(id),
  quantity integer not null default 1 check (quantity > 0),
  unique (raffle_id, loot_item_id)
);

create table if not exists raffle_entries (
  id uuid primary key default gen_random_uuid(),
  raffle_id uuid not null references raffles(id) on delete cascade,
  loot_item_id uuid not null references loot_items(id),
  discord_user_id text not null,
  discord_display_name text not null,
  created_at timestamptz not null default now(),
  unique (raffle_id, loot_item_id, discord_user_id)
);

create table if not exists raffle_winners (
  id uuid primary key default gen_random_uuid(),
  raffle_id uuid not null references raffles(id) on delete cascade,
  loot_item_id uuid not null references loot_items(id),
  loot_class_id uuid references loot_classes(id),
  discord_user_id text not null,
  discord_display_name text not null,
  won_at timestamptz not null default now()
);

create table if not exists player_cooldowns (
  discord_user_id text not null,
  loot_class_id uuid not null references loot_classes(id),
  cooldown_until timestamptz not null,
  source_winner_id uuid references raffle_winners(id),
  primary key (discord_user_id, loot_class_id)
);

create index if not exists idx_raffles_status_ends on raffles(status, ends_at);
create index if not exists idx_entries_raffle on raffle_entries(raffle_id);
create index if not exists idx_winners_raffle on raffle_winners(raffle_id);
