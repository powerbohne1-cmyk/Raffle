insert into loot_classes(name,color,cooldown_hours,sort_order) values
('Gold','gold',24,1),('Purple','purple',12,2),('Blue','blue',0,3),('Red','red',48,4)
on conflict (name) do nothing;
