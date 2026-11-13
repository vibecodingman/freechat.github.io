-- Inomesto: запрет изменения ролей участников тем, кто не является
-- владельцем или администратором именно этого пространства.
-- Глобальные модераторы сохраняют отдельные действия модерации (например,
-- блокировку участника и удаление пространства), но не получают роль админа канала.
--
-- Выполнить один раз в Supabase → SQL Editor → New query.

CREATE OR REPLACE FUNCTION public.guard_space_member_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_space_role text;
  actor_is_global_staff boolean;
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF OLD.role = 'owner' OR NEW.role = 'owner' THEN
      RAISE EXCEPTION 'Роль владельца канала нельзя изменить через управление участниками';
    END IF;

    SELECT sm.role
      INTO actor_space_role
      FROM public.space_members AS sm
     WHERE sm.space_id = OLD.space_id
       AND sm.user_id = auth.uid();

    SELECT (COALESCE(p.is_owner, false) OR COALESCE(p.is_coowner, false))
      INTO actor_is_global_staff
      FROM public.profiles AS p
     WHERE p.id = auth.uid();

    IF actor_space_role IS NULL
       OR actor_space_role NOT IN ('owner', 'admin')
       OR (COALESCE(actor_is_global_staff, false) AND actor_space_role <> 'owner') THEN
      RAISE EXCEPTION 'Изменять роли участников может владелец канала или его администратор, не являющийся глобальным модератором';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_space_member_role_changes
  ON public.space_members;

CREATE TRIGGER trg_guard_space_member_role_changes
BEFORE UPDATE OF role ON public.space_members
FOR EACH ROW
EXECUTE FUNCTION public.guard_space_member_role_changes();
