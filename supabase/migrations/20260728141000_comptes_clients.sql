-- Comptes clients du site
--
-- Jusqu'ici, `authenticated` signifiait « membre du personnel » : chaque policy
-- résout via `staff_profiles`. Ouvrir Auth au public est donc sûr par défaut —
-- un client connecté ne voit rien tant qu'aucune policy ne le nomme.
--
-- Règle à tenir pour toute policy ajoutée plus tard : cadrer par
-- `private.current_customer_id()`, jamais par `auth.uid() is not null`. La
-- seconde forme donnerait au premier inscrit venu ce que le personnel voit.

alter table customers
  add column if not exists auth_user_id uuid unique references auth.users (id) on delete set null;

comment on column customers.auth_user_id is
  'Compte du site rattaché à cette fiche. Null = client connu en boutique seulement. `on delete set null` : supprimer un compte n''efface pas l''historique d''achat, conservation comptable oblige.';

/* --------------------------------------------------------------------------
   Identité du client connecté
   -------------------------------------------------------------------------- */

create or replace function private.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
    from public.customers c
   where c.auth_user_id = (select auth.uid())
     and not c.is_anonymized;
$$;

-- `authenticated` doit garder EXECUTE : les policies ci-dessous appellent cette
-- fonction, et PostgreSQL évalue une expression de policy avec les droits du
-- rôle courant. La révoquer rendrait les policies inévaluables — donc muettes.
revoke all on function private.current_customer_id() from public, anon;
grant execute on function private.current_customer_id() to authenticated;

comment on function private.current_customer_id() is
  'Fiche client du compte connecté, ou null. Une fiche anonymisée (RGPD) ne répond plus : le droit à l''effacement l''emporte sur le confort de connexion.';

/* --------------------------------------------------------------------------
   Garde de colonnes : le client ne modifie que ses coordonnées
   -------------------------------------------------------------------------- */

-- La RLS travaille à la ligne. Sans cette garde, un client autorisé à mettre à
-- jour SA fiche pourrait aussi s'attribuer `is_privilege` ou réécrire son
-- `lifetime_value` par un PATCH PostgREST direct.
create or replace function private.guard_customer_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ignored text[] := array['is_anonymized', 'anonymized_at', 'updated_at',
    'lifetime_value'];
  -- Tout le reste appartient à la maison : privilège, historique, rattachement.
  customer_editable text[] := array['full_name', 'phone', 'street',
    'postal_code', 'city', 'country', 'updated_at'];
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  -- Chemin client : il édite sa propre fiche depuis le site.
  if old.auth_user_id is not null and old.auth_user_id = (select auth.uid()) then
    if (to_jsonb(new) - customer_editable) is distinct from (to_jsonb(old) - customer_editable) then
      raise exception 'Seules vos coordonnées peuvent être modifiées';
    end if;
    return new;
  end if;

  if (new.is_anonymized, new.anonymized_at)
     is distinct from (old.is_anonymized, old.anonymized_at)
     and not private.has_permission('clientele.rgpd') then
    raise exception 'Vous n''avez pas le droit d''anonymiser une fiche client';
  end if;

  if (to_jsonb(new) - ignored) is distinct from (to_jsonb(old) - ignored)
     and not private.has_permission('clientele.modifier')
     and not private.has_permission('clientele.rgpd') then
    raise exception 'Vous n''avez pas le droit de modifier une fiche client';
  end if;

  return new;
end;
$$;

/* --------------------------------------------------------------------------
   Policies additives
   -------------------------------------------------------------------------- */

-- Permissives : elles s'ajoutent en OR aux policies staff, sans rien leur
-- retirer. Un employé garde exactement la vue qu'il avait hier.

drop policy if exists "customer_select_self" on customers;
create policy "customer_select_self" on customers for select to authenticated
  using (auth_user_id = (select auth.uid()) and not is_anonymized);

drop policy if exists "customer_update_self" on customers;
create policy "customer_update_self" on customers for update to authenticated
  using (auth_user_id = (select auth.uid()) and not is_anonymized)
  with check (auth_user_id = (select auth.uid()) and not is_anonymized);

drop policy if exists "customer_select_own" on transactions;
create policy "customer_select_own" on transactions for select to authenticated
  using (customer_id = (select private.current_customer_id()));

drop policy if exists "customer_select_own" on transaction_items;
create policy "customer_select_own" on transaction_items for select to authenticated
  using (exists (
    select 1 from public.transactions t
     where t.id = transaction_items.transaction_id
       and t.customer_id = (select private.current_customer_id())
  ));

drop policy if exists "customer_select_own" on customer_consents;
create policy "customer_select_own" on customer_consents for select to authenticated
  using (customer_id = (select private.current_customer_id()));

/* --------------------------------------------------------------------------
   Le domaine de connexion du personnel est réservé
   -------------------------------------------------------------------------- */

-- Les employés se connectent par identifiant, sous `<identifiant>@maison-piron.invalid`
-- (domaine RFC 2606, jamais routable). L'inscription du site étant ouverte à
-- tous, rien n'empêcherait quelqu'un de déposer `camille@maison-piron.invalid`
-- pour bloquer la création future de ce compte employé.
--
-- Les deux chemins d'insertion — inscription publique et création par l'ERP —
-- passent par le même rôle Postgres et sont indiscernables côté base. Ce qui
-- les sépare, c'est `raw_app_meta_data` : GoTrue ne laisse pas le point de
-- terminaison public d'inscription en fixer le contenu, seule l'API admin
-- (clé service_role) le peut. D'où ce drapeau, posé par `createStaffAccount`.
create or replace function private.guard_reserved_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null
     and lower(new.email) like '%@maison-piron.invalid'
     and coalesce(new.raw_app_meta_data ->> 'staff', 'false') <> 'true' then
    raise exception 'Cette adresse est réservée aux comptes du personnel'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auth_users_reserved_email on auth.users;
create trigger trg_auth_users_reserved_email
  before insert on auth.users
  for each row execute function private.guard_reserved_email();

/* --------------------------------------------------------------------------
   Rattachement du compte à une fiche client
   -------------------------------------------------------------------------- */

-- Appelée juste après l'inscription. Un client déjà connu en boutique retrouve
-- son historique : c'est le même e-mail, donc la même personne — et c'est
-- l'intérêt d'avoir une base unique plutôt qu'un fichier clients par canal.
create or replace function public.link_customer_account(
  full_name_param text default null,
  phone_param text default null,
  marketing_param boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Connexion requise';
  end if;

  if exists (select 1 from public.staff_profiles sp where sp.id = v_uid) then
    raise exception 'Un compte du personnel ne peut pas être un compte client';
  end if;

  select lower(u.email::text) into v_email from auth.users u where u.id = v_uid;
  if v_email is null or v_email like '%@maison-piron.invalid' then
    raise exception 'Adresse e-mail invalide pour un compte client';
  end if;

  -- Déjà rattaché : l'appel est rejoué (double soumission, retour arrière).
  select c.id into v_id from public.customers c where c.auth_user_id = v_uid;
  if v_id is not null then
    return v_id;
  end if;

  -- Fiche existante non rattachée, même adresse : c'est le client de la boutique.
  -- Une fiche anonymisée n'est jamais reprise — l'effacement doit tenir.
  select c.id into v_id
    from public.customers c
   where lower(c.email) = v_email
     and c.auth_user_id is null
     and not c.is_anonymized
   order by c.created_at
   limit 1
   for update;

  if v_id is not null then
    update public.customers
       set auth_user_id = v_uid,
           full_name = coalesce(nullif(trim(full_name_param), ''), full_name),
           phone = coalesce(nullif(trim(phone_param), ''), phone)
     where id = v_id;
  else
    insert into public.customers (full_name, email, phone, auth_user_id)
    values (nullif(trim(full_name_param), ''), v_email, nullif(trim(phone_param), ''), v_uid)
    returning id into v_id;
  end if;

  -- Le consentement commercial est distinct de la création de compte : on ne
  -- le déduit pas d'une commande, on l'enregistre comme un choix daté (RGPD).
  insert into public.customer_consents (customer_id, granted, source)
  values (v_id, coalesce(marketing_param, false), 'site_web');

  return v_id;
end;
$$;

revoke all on function public.link_customer_account(text, text, boolean) from public, anon;
grant execute on function public.link_customer_account(text, text, boolean) to authenticated;

-- Le consentement se retire aussi facilement qu'il se donne : nouvelle ligne
-- datée, jamais de réécriture — c'est la trace qui vaut preuve.
create or replace function public.set_marketing_consent(granted_param boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := (select private.current_customer_id());
begin
  if v_id is null then
    raise exception 'Connexion requise';
  end if;

  insert into public.customer_consents (customer_id, granted, source)
  values (v_id, coalesce(granted_param, false), 'site_web');
end;
$$;

revoke all on function public.set_marketing_consent(boolean) from public, anon;
grant execute on function public.set_marketing_consent(boolean) to authenticated;
