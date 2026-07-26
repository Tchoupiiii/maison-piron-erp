-- Escalade de privilèges : « Gérer les employés » donnait administrateur
--
-- La policy `manage_staff` était en `for all`, donc l'UPDATE de `staff_profiles`
-- était ouvert à quiconque portait `systeme.employes`. Un PATCH direct sur
-- /rest/v1/staff_profiles?id=eq.<soi> avec {"role":"admin"} suffisait à se
-- promouvoir, sans passer par l'application ni par `admin_set_staff_role` — qui
-- vérifie pourtant `require_admin()`. Et `has_permission` court-circuite sur
-- `role = 'admin'` : la promotion ouvrait *toutes* les clés d'un coup.
--
-- Trois verrous, du plus extérieur au plus profond :
--   1. plus aucune écriture de `staff_profiles` par PostgREST ;
--   2. un trigger colonne, comme pour les pièces et les fiches clients ;
--   3. plus d'auto-attribution de permission, ni nominative ni par son rôle.

-- ---------------------------------------------------------------------------
-- 1. staff_profiles : lecture seule via l'API
-- ---------------------------------------------------------------------------
-- Toutes les écritures de l'application passent déjà ailleurs : création par la
-- clé service_role (`createStaffAccount`), rôle/activation/suppression par les
-- fonctions `admin_*`. Aucune policy d'écriture n'est donc nécessaire, et son
-- absence fait échouer par défaut tout chemin nouveau qui l'oublierait.
drop policy if exists "manage_staff" on staff_profiles;
drop policy if exists "admin_manage_staff" on staff_profiles;

-- ---------------------------------------------------------------------------
-- 2. Garde colonne, même principe que products / repair_tickets / customers
-- ---------------------------------------------------------------------------
create or replace function private.guard_staff_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- service_role, cron et console SQL n'ont pas de session : la RLS ne
  -- s'applique pas non plus dans ce cas.
  if (select auth.uid()) is null then
    return new;
  end if;

  -- Identité, rôle et activation ne bougent que sous une session administrateur,
  -- c'est-à-dire en pratique par les fonctions `admin_*` qui portent aussi
  -- l'invariant « il doit rester un administrateur actif ». Une permission
  -- « systeme.employes » gère des fiches, elle ne distribue pas les rôles.
  if (new.id, new.role, new.is_active, new.username)
     is distinct from (old.id, old.role, old.is_active, old.username)
     and coalesce((
       select sp.role = 'admin'
         from public.staff_profiles sp
        where sp.id = (select auth.uid()) and sp.is_active
     ), false) is not true then
    raise exception
      'Rôle, activation et identifiant de connexion se modifient depuis Réglages, par un administrateur';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_staff_profiles_guard_columns on staff_profiles;
create trigger trg_staff_profiles_guard_columns before update on staff_profiles
  for each row execute function private.guard_staff_columns();

-- ---------------------------------------------------------------------------
-- 3. Pas d'auto-attribution de permission
-- ---------------------------------------------------------------------------
-- `systeme.permissions` sert à régler les droits des autres. Se les accorder à
-- soi-même rouvrirait le même chemin : s'octroyer `systeme.employes`, puis
-- reprendre l'escalade ci-dessus. On coupe les deux voies — l'exception
-- nominative sur soi, et le défaut de son propre rôle.
--
-- Retirer une exception qui *refusait* un droit est une auto-attribution
-- déguisée : le DELETE sur soi est donc fermé lui aussi.
drop policy if exists "staff_insert" on staff_permissions;
drop policy if exists "staff_update" on staff_permissions;
drop policy if exists "staff_delete" on staff_permissions;

create policy "staff_insert" on staff_permissions
  for insert to authenticated
  with check (
    (select private.has_permission('systeme.permissions'))
    and staff_id <> (select auth.uid())
  );

create policy "staff_update" on staff_permissions
  for update to authenticated
  using (
    (select private.has_permission('systeme.permissions'))
    and staff_id <> (select auth.uid())
  )
  with check (
    (select private.has_permission('systeme.permissions'))
    and staff_id <> (select auth.uid())
  );

create policy "staff_delete" on staff_permissions
  for delete to authenticated
  using (
    (select private.has_permission('systeme.permissions'))
    and staff_id <> (select auth.uid())
  );

-- Le défaut d'un rôle vaut pour tous ceux qui le portent, soi compris : on ne
-- touche pas au sien. L'administrateur n'est pas concerné — ses droits ne
-- viennent pas de `role_permissions`, et l'écran refuse déjà d'éditer ce rôle.
drop policy if exists "staff_insert" on role_permissions;
drop policy if exists "staff_update" on role_permissions;
drop policy if exists "staff_delete" on role_permissions;

create policy "staff_insert" on role_permissions
  for insert to authenticated
  with check (
    (select private.has_permission('systeme.permissions'))
    and role <> (select private.current_staff_role())
  );

create policy "staff_update" on role_permissions
  for update to authenticated
  using (
    (select private.has_permission('systeme.permissions'))
    and role <> (select private.current_staff_role())
  )
  with check (
    (select private.has_permission('systeme.permissions'))
    and role <> (select private.current_staff_role())
  );

create policy "staff_delete" on role_permissions
  for delete to authenticated
  using (
    (select private.has_permission('systeme.permissions'))
    and role <> (select private.current_staff_role())
  );
