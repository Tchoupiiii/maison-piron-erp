-- Un compte authentifié ne suffit pas : il faut une fiche dans staff_profiles.
-- Sans ça, tout utilisateur inscrit aurait un accès complet aux données clients.

revoke execute on function public.fn_refresh_customer_lifetime_value() from anon, authenticated;
revoke execute on function public.fn_current_staff_role() from anon;

create or replace function fn_is_staff()
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

revoke execute on function public.fn_is_staff() from anon;

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
      'create policy "staff_select" on public.%I for select to authenticated using ((select public.fn_is_staff()))', t
    );
    execute format(
      'create policy "staff_insert" on public.%I for insert to authenticated with check ((select public.fn_is_staff()))', t
    );
    execute format(
      'create policy "staff_update" on public.%I for update to authenticated using ((select public.fn_is_staff())) with check ((select public.fn_is_staff()))', t
    );

    if t = any (deletable) then
      execute format(
        'create policy "staff_delete" on public.%I for delete to authenticated using ((select public.fn_is_staff()))', t
      );
    end if;
  end loop;
end;
$$;

-- staff_profiles : chacun lit sa propre fiche, seul un admin gère les autres
drop policy if exists "staff_select" on staff_profiles;
drop policy if exists "staff_insert" on staff_profiles;
drop policy if exists "staff_update" on staff_profiles;
drop policy if exists "staff_delete" on staff_profiles;

create policy "staff_read_roster" on staff_profiles
  for select to authenticated
  using ((select public.fn_is_staff()));

create policy "admin_manage_staff" on staff_profiles
  for all to authenticated
  using ((select public.fn_current_staff_role()) = 'admin')
  with check ((select public.fn_current_staff_role()) = 'admin');

-- Storage : même règle
drop policy if exists "staff_read_media" on storage.objects;
drop policy if exists "staff_write_media" on storage.objects;
drop policy if exists "staff_update_media" on storage.objects;
drop policy if exists "staff_delete_media" on storage.objects;

create policy "staff_read_media" on storage.objects
  for select to authenticated
  using (bucket_id in ('produit_media', 'repair_media', 'invoices') and (select public.fn_is_staff()));

create policy "staff_write_media" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('produit_media', 'repair_media', 'invoices') and (select public.fn_is_staff()));

create policy "staff_update_media" on storage.objects
  for update to authenticated
  using (bucket_id in ('produit_media', 'repair_media') and (select public.fn_is_staff()))
  with check (bucket_id in ('produit_media', 'repair_media') and (select public.fn_is_staff()));

create policy "staff_delete_media" on storage.objects
  for delete to authenticated
  using (bucket_id in ('produit_media', 'repair_media') and (select public.fn_is_staff()));
