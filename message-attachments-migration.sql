-- Inomesto: вложения в личных сообщениях
-- Выполнить один раз в Supabase → SQL Editor.
-- Файлы хранятся в существующем Storage bucket "attachments";
-- метаданные хранятся в строке сообщения и защищаются её RLS-политиками.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'messages_attachments_is_array'
      AND conrelid = 'public.messages'::regclass
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_attachments_is_array
      CHECK (jsonb_typeof(attachments) = 'array');
  END IF;
END
$$;
