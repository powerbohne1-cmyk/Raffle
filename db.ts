import { createClient } from '@supabase/supabase-js';
import { cfg } from './config.js';
export const db = createClient(cfg.supabaseUrl, cfg.serviceKey, { auth: { persistSession: false } });

export async function activeLoot() {
  const { data, error } = await db.from('loot_items').select('id,name,emoji,sort_order,loot_classes(id,name,color,cooldown_hours)').eq('active', true).order('sort_order');
  if (error) throw error;
  return data ?? [];
}

export async function activeClasses() {
  const { data, error } = await db.from('loot_classes').select('*').eq('active', true).order('sort_order');
  if (error) throw error;
  return data ?? [];
}
