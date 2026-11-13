-- Inomesto: channel identity and avatar support
-- Run this once in Supabase SQL Editor before using the new frontend.
alter table public.spaces
  add column if not exists avatar_url text;

comment on column public.spaces.avatar_url is
  'Path in the attachments storage bucket for the channel avatar';
