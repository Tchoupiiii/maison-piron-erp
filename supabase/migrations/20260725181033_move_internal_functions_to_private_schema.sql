-- Les helpers internes ne doivent pas être appelables via /rest/v1/rpc.
-- Le schéma `private` n'est pas exposé par PostgREST ; seul `calculate_dynamic_price`
-- reste dans `public` car l'application l'appelle en RPC.
create schema if not exists private;
revoke all on schema private from anon, authenticated;

create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_profiles where id = (select auth.uid())
  );
$$;

create or replace function private.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.staff_profiles where id = (select auth.uid());
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.refresh_customer_lifetime_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := coalesce(new.customer_id, old.customer_id);
begin
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

-- les policies RLS évaluent ces fonctions sous l'identité de l'appelant
grant usage on schema private to authenticated;
grant execute on function private.is_staff(), private.current_staff_role() to authenticated;

-- rebranchement des triggers
drop trigger trg_products_updated_at on products;
drop trigger trg_customers_updated_at on customers;
drop trigger trg_repair_tickets_updated_at on repair_tickets;
drop trigger trg_transactions_lifetime_value on transactions;

create trigger trg_products_updated_at before update on products
  for each row execute function private.touch_updated_at();
create trigger trg_customers_updated_at before update on customers
  for each row execute function private.touch_updated_at();
create trigger trg_repair_tickets_updated_at before update on repair_tickets
  for each row execute function private.touch_updated_at();
create trigger trg_transactions_lifetime_value
  after insert or update of amount_paid, status or delete on transactions
  for each row execute function private.refresh_customer_lifetime_value();

-- rebranchement des policies
do $$
declare
  t text;
  deletable text[] := array[
    'products', 'product_materials', 'product_gemstones', 'product_media',
    'customers', 'customer_preferences', 'customer_consents',
    'repair_tickets', 'repair_photos', 'market_rates'
  ];
  all_tables text[] := array[
    'products', 'product_materials', 'product_gemstones',
    'product_media', 'price_history', 'customers', 'customer_preferences',
    'customer_consents', 'rgpd_action_log', 'repair_tickets',
    'repair_status_history', 'repair_photos', 'transactions',
    'transaction_items', 'market_rates', 'metal_sync_log'
  ];
begin
  foreach t in array all_tables loop
    execute format('drop policy if exists "staff_select" on public.%I', t);
    execute format('drop policy if exists "staff_insert" on public.%I', t);
    execute format('drop policy if exists "staff_update" on public.%I', t);
    execute format('drop policy if exists "staff_delete" on public.%I', t);

    execute format(
      'create policy "staff_select" on public.%I for select to authenticated using ((select private.is_staff()))', t
    );
    execute format(
      'create policy "staff_insert" on public.%I for insert to authenticated with check ((select private.is_staff()))', t
    );
    execute format(
      'create policy "staff_update" on public.%I for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()))', t
    );

    if t = any (deletable) then
      execute format(
        'create policy "staff_delete" on public.%I for delete to authenticated using ((select private.is_staff()))', t
      );
    end if;
  end loop;
end;
$$;

drop policy if exists "staff_read_roster" on staff_profiles;
drop policy if exists "admin_manage_staff" on staff_profiles;

create policy "staff_read_roster" on staff_profiles
  for select to authenticated
  using ((select private.is_staff()));

create policy "admin_manage_staff" on staff_profiles
  for all to authenticated
  using ((select private.current_staff_role()) = 'admin')
  with check ((select private.current_staff_role()) = 'admin');

drop policy if exists "staff_read_media" on storage.objects;
drop policy if exists "staff_write_media" on storage.objects;
drop policy if exists "staff_update_media" on storage.objects;
drop policy if exists "staff_delete_media" on storage.objects;

create policy "staff_read_media" on storage.objects
  for select to authenticated
  using (bucket_id in ('produit_media', 'repair_media', 'invoices') and (select private.is_staff()));

create policy "staff_write_media" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('produit_media', 'repair_media', 'invoices') and (select private.is_staff()));

create policy "staff_update_media" on storage.objects
  for update to authenticated
  using (bucket_id in ('produit_media', 'repair_media') and (select private.is_staff()))
  with check (bucket_id in ('produit_media', 'repair_media') and (select private.is_staff()));

create policy "staff_delete_media" on storage.objects
  for delete to authenticated
  using (bucket_id in ('produit_media', 'repair_media') and (select private.is_staff()));

drop function if exists public.fn_is_staff();
drop function if exists public.fn_current_staff_role();
drop function if exists public.fn_touch_updated_at();
drop function if exists public.fn_refresh_customer_lifetime_value();
