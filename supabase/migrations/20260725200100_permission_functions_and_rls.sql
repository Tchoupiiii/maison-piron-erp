-- Contrôle d'accès fin : une permission par action métier, appliquée deux fois
-- (RLS en base, requirePermission dans les Server Actions).

-- Un compte désactivé perd tout accès sans être supprimé.
create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_profiles
     where id = (select auth.uid()) and is_active
  );
$$;

create or replace function private.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.staff_profiles
   where id = (select auth.uid()) and is_active;
$$;

-- admin ⇒ tout ; sinon exception nominative, à défaut le défaut du rôle.
create or replace function private.has_permission(key_param text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when sp.role = 'admin' then true
      else coalesce(
        (select up.granted
           from public.staff_permissions up
          where up.staff_id = sp.id and up.permission_key = key_param),
        exists (
          select 1 from public.role_permissions rp
           where rp.role = sp.role and rp.permission_key = key_param
        )
      )
    end
    from public.staff_profiles sp
   where sp.id = (select auth.uid()) and sp.is_active
  ), false);
$$;

create or replace function private.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((
    select role = 'admin' from public.staff_profiles
     where id = (select auth.uid()) and is_active
  ), false) is not true then
    raise exception 'Action réservée aux administrateurs';
  end if;
end;
$$;

grant execute on function private.has_permission(text) to authenticated;

-- Permissions effectives de l'appelant : alimente la navigation et le masquage
-- des actions. Les tables de permissions elles-mêmes restent illisibles pour
-- qui n'a pas « systeme.journal ».
create or replace function public.my_permissions()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select pc.key
    from public.permission_catalogue pc
   where private.has_permission(pc.key);
$$;

revoke all on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated;

-- Une vente de comptoir n'a pas de client : ne rien recalculer dans ce cas.
create or replace function private.refresh_customer_lifetime_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := coalesce(new.customer_id, old.customer_id);
begin
  if v_customer_id is null then
    return null;
  end if;
  update public.customers c
     set lifetime_value = coalesce((
           select sum(t.amount_paid)
             from public.transactions t
            where t.customer_id = v_customer_id
              and t.status <> 'annulee'
         ), 0)
   where c.id = v_customer_id;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Journal : seule voie d'écriture, l'auteur est estampillé par la base et non
-- fourni par l'appelant. Aucune policy INSERT sur activity_log, donc pas de
-- ligne forgeable via /rest/v1.
-- ---------------------------------------------------------------------------
create or replace function public.log_activity(
  action_param activity_action,
  summary_param text,
  entity_type_param text default null,
  entity_id_param uuid default null,
  entity_label_param text default null,
  changes_param jsonb default null,
  ip_param text default null,
  user_agent_param text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_actor uuid := (select auth.uid());
  v_name text;
  v_role public.staff_role;
  v_ip inet;
begin
  if v_actor is null then
    raise exception 'Journalisation impossible sans session';
  end if;

  select sp.full_name, sp.role into v_name, v_role
    from public.staff_profiles sp
   where sp.id = v_actor;

  if v_name is null then
    raise exception 'Compte sans fiche employé';
  end if;

  begin
    v_ip := nullif(btrim(ip_param), '')::inet;
  exception when others then
    v_ip := null;
  end;

  insert into public.activity_log (
    actor_id, actor_name, actor_role, action, entity_type, entity_id,
    entity_label, summary, changes, ip_address, user_agent
  ) values (
    v_actor, v_name, v_role, action_param, entity_type_param, entity_id_param,
    entity_label_param, summary_param, changes_param, v_ip,
    nullif(btrim(user_agent_param), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.log_activity(
  activity_action, text, text, uuid, text, jsonb, text, text) from public, anon;
grant execute on function public.log_activity(
  activity_action, text, text, uuid, text, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Vente atomique. Les prix sont dérivés en base : le montant envoyé par le
-- poste de caisse n'est jamais retenu, et un échec en cours de route ne laisse
-- pas de vente orpheline.
-- ---------------------------------------------------------------------------
create or replace function public.create_sale(
  items_param jsonb,
  customer_id_param uuid default null,
  terminal_id_param uuid default null,
  payment_method_param payment_method default null,
  discount_param numeric default 0,
  mark_paid_param boolean default false,
  emit_invoice_param boolean default false
)
returns table (transaction_id uuid, transaction_ref text, total_amount numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_product record;
  v_ticket record;
  v_price record;
  v_qty integer;
  v_unit_ht numeric;
  v_total numeric := 0;
  v_tx uuid;
  v_ref text;
  v_year text := to_char(now(), 'YYYY');
  v_prefix text;
  v_seq integer;
  v_status public.transaction_status;
  v_sold uuid[] := '{}';
  v_lines jsonb := '[]'::jsonb;
begin
  if not private.has_permission('ventes.creer') then
    raise exception 'Vous n''avez pas le droit d''encaisser une vente';
  end if;

  if jsonb_typeof(items_param) <> 'array' or jsonb_array_length(items_param) = 0 then
    raise exception 'Une vente comporte au moins une ligne';
  end if;

  if emit_invoice_param then
    if customer_id_param is null then
      raise exception 'Une facture nominative exige un client identifié';
    end if;
    if not private.has_permission('ventes.facturer') then
      raise exception 'Vous n''avez pas le droit d''émettre une facture';
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(items_param) loop
    v_qty := coalesce((v_item ->> 'quantity')::integer, 1);
    if v_qty <= 0 then
      raise exception 'Quantité invalide';
    end if;

    if v_item ? 'product_id' and (v_item ->> 'product_id') is not null then
      select p.id, p.sku, p.name, p.status into v_product
        from public.products p where p.id = (v_item ->> 'product_id')::uuid;

      if v_product.id is null then
        raise exception 'Pièce introuvable';
      end if;
      if v_product.status = 'vendu' then
        raise exception '% est déjà vendue', v_product.name;
      end if;

      select * into v_price from public.calculate_dynamic_price(v_product.id);
      if v_price.has_missing_rate then
        raise exception 'Cours du métal manquant pour % : synchronisez avant de vendre', v_product.sku;
      end if;

      v_unit_ht := v_price.ht;
      v_sold := v_sold || v_product.id;
      v_lines := v_lines || jsonb_build_object(
        'product_id', v_product.id,
        'repair_ticket_id', null,
        'description', v_product.name || ' · ' || v_product.sku,
        'unit_price_ht', v_unit_ht,
        'quantity', v_qty
      );

    elsif v_item ? 'repair_ticket_id' and (v_item ->> 'repair_ticket_id') is not null then
      select t.id, t.ref, t.description, coalesce(t.actual_price, t.estimated_price) as price
        into v_ticket
        from public.repair_tickets t where t.id = (v_item ->> 'repair_ticket_id')::uuid;

      if v_ticket.id is null then
        raise exception 'Réparation introuvable';
      end if;
      if v_ticket.price is null then
        raise exception 'Chiffrez la réparation % avant de la facturer', v_ticket.ref;
      end if;

      -- le prix atelier est saisi TTC
      v_unit_ht := round(v_ticket.price / 1.21, 2);
      v_lines := v_lines || jsonb_build_object(
        'product_id', null,
        'repair_ticket_id', v_ticket.id,
        'description', 'Réparation ' || v_ticket.ref || ' · ' || v_ticket.description,
        'unit_price_ht', v_unit_ht,
        'quantity', v_qty
      );

    else
      raise exception 'Chaque ligne vise une pièce ou une réparation';
    end if;

    v_total := v_total + round(v_unit_ht * v_qty * 1.21, 2);
  end loop;

  v_total := round(v_total - coalesce(discount_param, 0), 2);
  if v_total < 0 then
    raise exception 'La remise dépasse le montant de la vente';
  end if;

  if emit_invoice_param then
    v_prefix := 'FA-' || v_year || '-';
  elsif mark_paid_param then
    v_prefix := 'TIC-' || v_year || '-';
  else
    v_prefix := null;
  end if;

  if v_prefix is not null then
    -- sérialise la numérotation : deux caisses simultanées ne peuvent pas
    -- tomber sur le même numéro
    perform pg_advisory_xact_lock(hashtext(v_prefix));
    select coalesce(max(substring(t.ref from '[0-9]+$')::integer), 0) + 1
      into v_seq
      from public.transactions t
     where t.ref like v_prefix || '%';
    v_ref := v_prefix || lpad(v_seq::text, 4, '0');
  end if;

  v_status := case
    when mark_paid_param then 'payee'
    when emit_invoice_param then 'emise'
    else 'brouillon'
  end;

  insert into public.transactions (
    ref, customer_id, terminal_id, status, total_amount, amount_paid,
    discount_amount, payment_method, issued_at, created_by
  ) values (
    v_ref, customer_id_param, terminal_id_param, v_status, v_total,
    case when mark_paid_param then v_total else 0 end,
    coalesce(discount_param, 0), payment_method_param,
    case when v_prefix is not null then now() else null end,
    (select auth.uid())
  )
  returning id into v_tx;

  insert into public.transaction_items (
    transaction_id, product_id, repair_ticket_id, description, unit_price_ht, quantity
  )
  select v_tx,
         nullif(l ->> 'product_id', '')::uuid,
         nullif(l ->> 'repair_ticket_id', '')::uuid,
         l ->> 'description',
         (l ->> 'unit_price_ht')::numeric,
         (l ->> 'quantity')::integer
    from jsonb_array_elements(v_lines) l;

  if array_length(v_sold, 1) > 0 then
    update public.products
       set status = 'vendu', sold_at = now()
     where id = any (v_sold);
  end if;

  return query select v_tx, v_ref, v_total;
end;
$$;

revoke all on function public.create_sale(
  jsonb, uuid, uuid, payment_method, numeric, boolean, boolean) from public, anon;
grant execute on function public.create_sale(
  jsonb, uuid, uuid, payment_method, numeric, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Administration des comptes. Ces fonctions sont appelables via /rest/v1/rpc,
-- d'où la vérification du rôle à l'intérieur de chacune.
-- ---------------------------------------------------------------------------
create or replace function public.admin_active_sessions()
returns table (
  session_id uuid,
  user_id uuid,
  full_name text,
  email text,
  role staff_role,
  ip text,
  user_agent text,
  started_at timestamptz,
  last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select s.id, s.user_id, sp.full_name, u.email::text, sp.role,
           host(s.ip), s.user_agent, s.created_at,
           coalesce(s.refreshed_at at time zone 'UTC', s.created_at)
      from auth.sessions s
      join public.staff_profiles sp on sp.id = s.user_id
      join auth.users u on u.id = s.user_id
     order by coalesce(s.refreshed_at at time zone 'UTC', s.created_at) desc;
end;
$$;

create or replace function public.admin_revoke_sessions(target_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.require_admin();
  delete from auth.refresh_tokens where user_id = target_user_id::text;
  delete from auth.sessions where user_id = target_user_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.admin_set_staff_active(
  target_user_id uuid,
  active_param boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();

  if not active_param and target_user_id = (select auth.uid()) then
    raise exception 'Vous ne pouvez pas désactiver votre propre compte';
  end if;

  if not active_param and (
    select count(*) from public.staff_profiles
     where role = 'admin' and is_active and id <> target_user_id
  ) = 0 then
    raise exception 'Il doit rester au moins un administrateur actif';
  end if;

  update public.staff_profiles
     set is_active = active_param,
         deactivated_at = case when active_param then null else now() end
   where id = target_user_id;

  if not active_param then
    delete from auth.refresh_tokens where user_id = target_user_id::text;
    delete from auth.sessions where user_id = target_user_id;
  end if;
end;
$$;

create or replace function public.admin_set_staff_role(
  target_user_id uuid,
  role_param staff_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();

  if role_param <> 'admin' and (
    select count(*) from public.staff_profiles
     where role = 'admin' and is_active and id <> target_user_id
  ) = 0 then
    raise exception 'Il doit rester au moins un administrateur actif';
  end if;

  update public.staff_profiles set role = role_param where id = target_user_id;
end;
$$;

-- Suppression définitive : l'historique comptable survit grâce aux clés
-- étrangères passées en « on delete set null », mais le nom de l'auteur
-- reste figé dans activity_log.
create or replace function public.admin_delete_staff(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();

  if target_user_id = (select auth.uid()) then
    raise exception 'Vous ne pouvez pas supprimer votre propre compte';
  end if;

  if (
    select count(*) from public.staff_profiles
     where role = 'admin' and is_active and id <> target_user_id
  ) = 0 then
    raise exception 'Il doit rester au moins un administrateur actif';
  end if;

  delete from auth.users where id = target_user_id;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_active_sessions()',
    'public.admin_revoke_sessions(uuid)',
    'public.admin_set_staff_active(uuid, boolean)',
    'public.admin_set_staff_role(uuid, public.staff_role)',
    'public.admin_delete_staff(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS : une permission par opération et par table.
-- ---------------------------------------------------------------------------
alter table metal_titles enable row level security;
alter table permission_catalogue enable row level security;
alter table role_permissions enable row level security;
alter table staff_permissions enable row level security;
alter table activity_log enable row level security;
alter table pos_terminals enable row level security;

do $$
declare
  r record;
  expr text;
begin
  for r in
    select * from (values
      -- table,                 select,             insert,                        update,                                delete
      ('products',              'inventaire.voir',  'inventaire.creer',            'inventaire.modifier|inventaire.statut', 'inventaire.supprimer'),
      ('product_materials',     'inventaire.voir',  'inventaire.modifier',         'inventaire.modifier',                  'inventaire.modifier'),
      ('product_gemstones',     'inventaire.voir',  'inventaire.modifier',         'inventaire.modifier',                  'inventaire.modifier'),
      ('product_media',         'inventaire.voir',  'inventaire.modifier',         'inventaire.modifier',                  'inventaire.modifier'),
      ('price_history',         'inventaire.voir',  'inventaire.prix',             null,                                   null),
      ('customers',             'clientele.voir',   'clientele.creer',             'clientele.modifier|clientele.rgpd',    'clientele.supprimer'),
      ('customer_preferences',  'clientele.voir',   'clientele.modifier',          'clientele.modifier',                   'clientele.modifier|clientele.rgpd'),
      ('customer_consents',     'clientele.voir',   'clientele.modifier',          'clientele.modifier',                   'clientele.modifier|clientele.rgpd'),
      ('rgpd_action_log',       'clientele.rgpd',   'clientele.rgpd',              null,                                   null),
      ('repair_tickets',        'atelier.voir',     'atelier.creer',               'atelier.statut',                       'atelier.supprimer'),
      ('repair_status_history', 'atelier.voir',     'atelier.creer|atelier.statut', null,                                  null),
      ('repair_photos',         'atelier.voir',     'atelier.creer',               'atelier.creer',                        'atelier.creer'),
      ('transactions',          'ventes.voir',      'ventes.creer',                'ventes.paiement|ventes.facturer',      null),
      ('transaction_items',     'ventes.voir',      'ventes.creer',                null,                                   null),
      ('market_rates',          'metaux.voir',      'metaux.sync',                 'metaux.sync',                          'metaux.sync'),
      ('metal_sync_log',        'metaux.voir',      'metaux.sync',                 null,                                   null),
      ('activity_log',          'systeme.journal',  null,                          null,                                   null),
      ('role_permissions',      'systeme.journal',  'systeme.permissions',         'systeme.permissions',                  'systeme.permissions'),
      ('staff_permissions',     'systeme.journal',  'systeme.permissions',         'systeme.permissions',                  'systeme.permissions'),
      ('pos_terminals',         null,               'systeme.caisses',             'systeme.caisses',                      'systeme.caisses')
    ) as t(tbl, sel, ins, upd, del)
  loop
    execute format('drop policy if exists "staff_select" on public.%I', r.tbl);
    execute format('drop policy if exists "staff_insert" on public.%I', r.tbl);
    execute format('drop policy if exists "staff_update" on public.%I', r.tbl);
    execute format('drop policy if exists "staff_delete" on public.%I', r.tbl);

    -- une colonne nulle signifie « tout le personnel » pour SELECT,
    -- et « opération interdite » pour INSERT/UPDATE/DELETE
    expr := case
      when r.sel is null then '(select private.is_staff())'
      else (select string_agg(format('(select private.has_permission(%L))', k), ' or ')
              from unnest(string_to_array(r.sel, '|')) k)
    end;
    execute format('create policy "staff_select" on public.%I for select to authenticated using (%s)', r.tbl, expr);

    if r.ins is not null then
      expr := (select string_agg(format('(select private.has_permission(%L))', k), ' or ')
                 from unnest(string_to_array(r.ins, '|')) k);
      execute format('create policy "staff_insert" on public.%I for insert to authenticated with check (%s)', r.tbl, expr);
    end if;

    if r.upd is not null then
      expr := (select string_agg(format('(select private.has_permission(%L))', k), ' or ')
                 from unnest(string_to_array(r.upd, '|')) k);
      execute format('create policy "staff_update" on public.%I for update to authenticated using (%s) with check (%s)', r.tbl, expr, expr);
    end if;

    if r.del is not null then
      expr := (select string_agg(format('(select private.has_permission(%L))', k), ' or ')
                 from unnest(string_to_array(r.del, '|')) k);
      execute format('create policy "staff_delete" on public.%I for delete to authenticated using (%s)', r.tbl, expr);
    end if;
  end loop;
end;
$$;

-- Référentiels : lisibles par tout le personnel, modifiables par l'admin seul.
create policy "staff_read_titles" on metal_titles
  for select to authenticated using ((select private.is_staff()));
create policy "admin_manage_titles" on metal_titles
  for all to authenticated
  using ((select private.current_staff_role()) = 'admin')
  with check ((select private.current_staff_role()) = 'admin');

create policy "staff_read_permission_catalogue" on permission_catalogue
  for select to authenticated using ((select private.is_staff()));

drop policy if exists "staff_read_roster" on staff_profiles;
drop policy if exists "admin_manage_staff" on staff_profiles;

create policy "staff_read_roster" on staff_profiles
  for select to authenticated using ((select private.is_staff()));

create policy "manage_staff" on staff_profiles
  for all to authenticated
  using ((select private.has_permission('systeme.employes')))
  with check ((select private.has_permission('systeme.employes')));

-- Storage : le stock suit l'inventaire, les photos d'atelier suivent l'atelier.
drop policy if exists "staff_read_media" on storage.objects;
drop policy if exists "staff_write_media" on storage.objects;
drop policy if exists "staff_update_media" on storage.objects;
drop policy if exists "staff_delete_media" on storage.objects;

create policy "staff_read_media" on storage.objects
  for select to authenticated
  using (bucket_id in ('produit_media', 'repair_media', 'invoices') and (select private.is_staff()));

create policy "staff_write_media" on storage.objects
  for insert to authenticated
  with check (
    (bucket_id = 'produit_media' and (select private.has_permission('inventaire.modifier')))
    or (bucket_id = 'repair_media' and (select private.has_permission('atelier.creer')))
    or (bucket_id = 'invoices' and (select private.has_permission('ventes.facturer')))
  );

create policy "staff_update_media" on storage.objects
  for update to authenticated
  using (
    (bucket_id = 'produit_media' and (select private.has_permission('inventaire.modifier')))
    or (bucket_id = 'repair_media' and (select private.has_permission('atelier.creer')))
  )
  with check (
    (bucket_id = 'produit_media' and (select private.has_permission('inventaire.modifier')))
    or (bucket_id = 'repair_media' and (select private.has_permission('atelier.creer')))
  );

create policy "staff_delete_media" on storage.objects
  for delete to authenticated
  using (
    (bucket_id = 'produit_media' and (select private.has_permission('inventaire.supprimer')))
    or (bucket_id = 'repair_media' and (select private.has_permission('atelier.supprimer')))
  );
