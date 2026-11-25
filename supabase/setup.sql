-- Public shared skate spot map. Visitors can read and add entries without an account.
create table public.spots (
  id uuid primary key default gen_random_uuid(),
  name varchar(70) not null check (length(trim(name)) > 0),
  category text not null check (category in ('Перила', 'Грань', 'Лестница', 'Скейт-парк', 'Мануал-бокс', 'Другое')),
  note varchar(220) not null default '',
  city text not null check (city in ('novi-sad', 'belgrade')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  photo_url text,
  created_at timestamptz not null default now()
);

alter table public.spots enable row level security;
grant select, insert on public.spots to anon, authenticated;
create policy "Anyone can view spots" on public.spots for select to anon, authenticated using (true);
create policy "Anyone can add spots" on public.spots for insert to anon, authenticated with check (true);

-- Photos are public so everyone viewing the map can see them. Uploads are limited
-- to small image files; public visitors cannot replace or delete uploaded files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('spot-photos', 'spot-photos', true, 3670016, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Anyone can view spot photos" on storage.objects for select to anon, authenticated using (bucket_id = 'spot-photos');
create policy "Anyone can upload spot photos" on storage.objects for insert to anon, authenticated with check (bucket_id = 'spot-photos');

-- Enable live INSERT events for connected browsers.
alter publication supabase_realtime add table public.spots;

insert into public.spots (id, name, category, note, city, lat, lng, photo_url)
values
  ('8d2d7208-8bee-4314-af9b-e05f62723001', 'Скейт-парк Нови-Сад', 'Скейт-парк', 'Стартовая точка — парк в районе Лиман.', 'novi-sad', 45.2385, 19.8462, 'https://novisad.rs/sites/default/files/imagecache/800xXXX/images/vratolomije4.jpg'),
  ('8d2d7208-8bee-4314-af9b-e05f62723002', 'Скейт-парк Ушче', 'Скейт-парк', 'Стартовая точка для спотов на Ушче.', 'belgrade', 44.81538, 20.44065, 'https://www.eyesonbelgrade.com/images/NewBelgrade/Skateboardramps.jpg')
on conflict (id) do nothing;
