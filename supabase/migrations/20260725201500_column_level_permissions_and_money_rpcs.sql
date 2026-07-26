-- La RLS protège la ligne, jamais la colonne : accorder « changer le statut »
-- accordait en pratique le droit de réécrire le coefficient de marge (vérifié
-- en conditions réelles avec le compte vendeuse). Deux réponses : des triggers
-- qui comparent colonne par colonne, et des fonctions dédiées pour l'argent.

-- remise en état de la marge écrasée pendant le test de sécurité
update products set margin_multiplier = 2.10 where sku = 'MP-BAG-0412';
update products p
   set cached_metal_cost = c.metal_cost,
       cached_stone_cost = c.stone_cost,
       cached_ht = c.ht,
       cached_ttc = c.ttc,
       price_computed_at = now()
  from (
    select pr.id, dp.*
      from products pr
      cross join lateral calculate_dynamic_price(pr.id) dp
     where pr.sku = 'MP-BAG-0412'
  ) c
 where c.id = p.id;

insert into permission_catalogue (key, category, label, description, sort) values
  ('atelier.modifier', 'Atelier', 'Modifier un ticket', 'Éditer la description, le chiffrage et l''échéance d''une réparation', 25);

insert into role_permissions (role, permission_key) values ('gemmologue', 'atelier.modifier');

-- ---------------------------------------------------------------------------
-- Contrôles colonne par colonne
-- ---------------------------------------------------------------------------
create or replace function private.guard_product_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ignored text[] := array['status', 'sold_at', 'updated_at',
    'margin_multiplier', 'labor_cost_eur', 'labor_description',
    'cached_metal_cost', 'cached_stone_cost', 'cached_ht', 'cached_ttc',
    'price_computed_at'];
begin
  -- service_role, cron et console SQL n'ont pas de session : la RLS ne
  -- s'applique pas non plus dans ce cas.
  if (select auth.uid()) is null then
    return new;
  end if;

  if (new.status, new.sold_at) is distinct from (old.status, old.sold_at)
     and not private.has_permission('inventaire.statut') then
    raise exception 'Vous n''avez pas le droit de changer le statut d''une pièce';
  end if;

  if (new.margin_multiplier, new.labor_cost_eur, new.labor_description,
      new.cached_metal_cost, new.cached_stone_cost, new.cached_ht,
      new.cached_ttc, new.price_computed_at)
     is distinct from
     (old.margin_multiplier, old.labor_cost_eur, old.labor_description,
      old.cached_metal_cost, old.cached_stone_cost, old.cached_ht,
      old.cached_ttc, old.price_computed_at)
     and not private.has_permission('inventaire.prix') then
    raise exception 'Vous n''avez pas le droit de modifier les prix';
  end if;

  if (to_jsonb(new) - ignored) is distinct from (to_jsonb(old) - ignored)
     and not private.has_permission('inventaire.modifier') then
    raise exception 'Vous n''avez pas le droit de modifier une pièce';
  end if;

  return new;
end;
$$;

create trigger trg_products_guard_columns before update on products
  for each row execute function private.guard_product_columns();

create or replace function private.guard_repair_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ignored text[] := array['status', 'delivered_at', 'updated_at'];
begin
  -- service_role, cron et console SQL n'ont pas de session : la RLS ne
  -- s'applique pas non plus dans ce cas.
  if (select auth.uid()) is null then
    return new;
  end if;

  if (new.status, new.delivered_at) is distinct from (old.status, old.delivered_at)
     and not private.has_permission('atelier.statut') then
    raise exception 'Vous n''avez pas le droit de faire avancer un ticket';
  end if;

  if (to_jsonb(new) - ignored) is distinct from (to_jsonb(old) - ignored)
     and not private.has_permission('atelier.modifier') then
    raise exception 'Vous n''avez pas le droit de modifier un ticket';
  end if;

  return new;
end;
$$;

create trigger trg_repair_tickets_guard_columns before update on repair_tickets
  for each row execute function private.guard_repair_columns();

create or replace function private.guard_customer_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ignored text[] := array['is_anonymized', 'anonymized_at', 'updated_at',
    'lifetime_value'];
begin
  -- service_role, cron et console SQL n'ont pas de session : la RLS ne
  -- s'applique pas non plus dans ce cas.
  if (select auth.uid()) is null then
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

create trigger trg_customers_guard_columns before update on customers
  for each row execute function private.guard_customer_columns();

-- ---------------------------------------------------------------------------
-- Statut d'une pièce : seule voie pour qui n'a pas l'édition complète.
-- ---------------------------------------------------------------------------
create or replace function public.set_product_status(
  product_id_param uuid,
  status_param product_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('inventaire.statut') then
    raise exception 'Vous n''avez pas le droit de changer le statut d''une pièce';
  end if;

  if status_param = 'vendu' then
    raise exception 'Une pièce passe en vendu par l''encaissement, pas à la main';
  end if;

  if exists (
    select 1 from public.products p
     where p.id = product_id_param and p.status = 'vendu'
  ) then
    raise exception 'Cette pièce est vendue : son statut ne peut plus changer';
  end if;

  update public.products set status = status_param where id = product_id_param;
end;
$$;

-- ---------------------------------------------------------------------------
-- Atelier : le changement de statut écrit lui-même sa ligne d'historique.
-- ---------------------------------------------------------------------------
create or replace function public.set_repair_status(
  ticket_id_param uuid,
  status_param repair_status
)
returns table (previous_status repair_status, customer_email text, customer_name text, ticket_ref text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.repair_status;
begin
  if not private.has_permission('atelier.statut') then
    raise exception 'Vous n''avez pas le droit de faire avancer un ticket';
  end if;

  select t.status into v_old
    from public.repair_tickets t where t.id = ticket_id_param;

  if v_old is null then
    raise exception 'Ticket introuvable';
  end if;

  update public.repair_tickets
     set status = status_param,
         delivered_at = case when status_param = 'delivered' then now() else delivered_at end
   where id = ticket_id_param;

  insert into public.repair_status_history (repair_ticket_id, from_status, to_status, changed_by)
  values (ticket_id_param, v_old, status_param, (select auth.uid()));

  return query
    select v_old, c.email, c.full_name, t.ref
      from public.repair_tickets t
      left join public.customers c on c.id = t.customer_id and not c.is_anonymized
     where t.id = ticket_id_param;
end;
$$;

-- ---------------------------------------------------------------------------
-- Argent : plus aucune écriture directe sur transactions. Un montant ou un
-- numéro de facture ne peut plus être réécrit depuis le client.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(
  transaction_id_param uuid,
  amount_param numeric
)
returns table (amount_paid numeric, outstanding numeric, status transaction_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx record;
  v_paid numeric;
  v_status public.transaction_status;
begin
  if not private.has_permission('ventes.paiement') then
    raise exception 'Vous n''avez pas le droit d''enregistrer un paiement';
  end if;

  if amount_param is null or amount_param <= 0 then
    raise exception 'Montant invalide';
  end if;

  select t.id, t.status, t.total_amount, t.amount_paid into v_tx
    from public.transactions t where t.id = transaction_id_param;

  if v_tx.id is null then
    raise exception 'Vente introuvable';
  end if;
  if v_tx.status = 'annulee' then
    raise exception 'Vente annulée';
  end if;
  if v_tx.status = 'brouillon' then
    raise exception 'Émettez la facture avant d''enregistrer un paiement';
  end if;

  v_paid := round(v_tx.amount_paid + amount_param, 2);
  if v_paid > v_tx.total_amount then
    raise exception 'Le montant dépasse le solde dû';
  end if;

  v_status := case when v_paid >= v_tx.total_amount then 'payee' else 'payee_partielle' end;

  update public.transactions
     set amount_paid = v_paid, status = v_status
   where id = transaction_id_param;

  return query select v_paid, round(v_tx.total_amount - v_paid, 2), v_status;
end;
$$;

create or replace function public.emit_invoice(
  transaction_id_param uuid,
  due_days_param integer default 14
)
returns table (ref text, due_at date, total_amount numeric, customer_email text, customer_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx record;
  v_prefix text := 'FA-' || to_char(now(), 'YYYY') || '-';
  v_seq integer;
  v_ref text;
  v_due date := (now() + make_interval(days => due_days_param))::date;
begin
  if not private.has_permission('ventes.facturer') then
    raise exception 'Vous n''avez pas le droit d''émettre une facture';
  end if;

  select t.id, t.ref, t.status, t.total_amount, t.customer_id into v_tx
    from public.transactions t where t.id = transaction_id_param;

  if v_tx.id is null then
    raise exception 'Vente introuvable';
  end if;
  if v_tx.status <> 'brouillon' then
    raise exception 'Cette vente porte déjà un numéro de document';
  end if;
  if v_tx.customer_id is null then
    raise exception 'Une facture nominative exige un client identifié';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_prefix));
  select coalesce(max(substring(t.ref from '[0-9]+$')::integer), 0) + 1
    into v_seq
    from public.transactions t
   where t.ref like v_prefix || '%';
  v_ref := v_prefix || lpad(v_seq::text, 4, '0');

  update public.transactions
     set ref = v_ref, status = 'emise', issued_at = now(), due_at = v_due
   where id = transaction_id_param;

  return query
    select v_ref, v_due, v_tx.total_amount, c.email, c.full_name
      from public.customers c
     where c.id = v_tx.customer_id and not c.is_anonymized;
end;
$$;

create or replace function public.mark_invoice_sent(transaction_id_param uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('ventes.facturer') then
    raise exception 'Droit insuffisant';
  end if;
  update public.transactions set sent_at = now() where id = transaction_id_param;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.set_product_status(uuid, public.product_status)',
    'public.set_repair_status(uuid, public.repair_status)',
    'public.record_payment(uuid, numeric)',
    'public.emit_invoice(uuid, integer)',
    'public.mark_invoice_sent(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

drop policy if exists "staff_insert" on transactions;
drop policy if exists "staff_update" on transactions;
drop policy if exists "staff_insert" on transaction_items;
