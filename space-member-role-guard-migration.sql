-- Inomesto: защита ролей участников на уровне базы данных.
-- Владелец канала может назначать администраторов. Администратор канала,
-- не являющийся глобальным модератором, также может менять роли участников.
-- Глобальные модераторы сохраняют kick/ban и удаление каналов, но не получают
-- права администратора чужого канала и не могут менять роли в нём.
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
  space_owner_id uuid;
BEGIN
  SELECT (COALESCE(p.is_owner, false) OR COALESCE(p.is_coowner, false))
    INTO actor_is_global_staff
    FROM public.profiles AS p
   WHERE p.id = auth.uid();

  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'owner' THEN
      SELECT s.owner_id
        INTO space_owner_id
        FROM public.spaces AS s
       WHERE s.id = NEW.space_id;

      IF space_owner_id IS DISTINCT FROM auth.uid()
         OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Владельцем канала может стать только создатель канала';
      END IF;
    ELSIF NEW.role = 'admin' THEN
      SELECT sm.role
        INTO actor_space_role
        FROM public.space_members AS sm
       WHERE sm.space_id = NEW.space_id
         AND sm.user_id = auth.uid();

      IF NEW.user_id = auth.uid()
         OR actor_space_role IS NULL
         OR actor_space_role NOT IN ('owner', 'admin')
         OR (COALESCE(actor_is_global_staff, false) AND actor_space_role <> 'owner') THEN
        RAISE EXCEPTION 'Назначать администраторов может только владелец канала или его администратор, не являющийся глобальным модератором';
      END IF;
    END IF;

  ELSIF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role THEN
    IF OLD.role = 'owner' OR NEW.role = 'owner' THEN
      RAISE EXCEPTION 'Роль владельца канала нельзя изменить через управление участниками';
    END IF;

    SELECT sm.role
      INTO actor_space_role
      FROM public.space_members AS sm
     WHERE sm.space_id = OLD.space_id
       AND sm.user_id = auth.uid();

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
DROP TRIGGER IF EXISTS trg_guard_space_member_role_inserts
  ON public.space_members;

CREATE TRIGGER trg_guard_space_member_role_changes
BEFORE UPDATE OF role ON public.space_members
FOR EACH ROW
EXECUTE FUNCTION public.guard_space_member_role_changes();

CREATE TRIGGER trg_guard_space_member_role_inserts
BEFORE INSERT ON public.space_members
FOR EACH ROW
EXECUTE FUNCTION public.guard_space_member_role_changes();
