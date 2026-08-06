-- Favoris du site (« liste de souhaits »)
--
-- Réutilise le pattern posé par comptes_clients : FK directe vers `customers`,
-- pas de table de comptes séparée. Écriture uniquement via wishlist_add/
-- wishlist_remove (comme customer_consents/set_marketing_consent) : aucune
-- policy d'écriture directe, donc aucun trigger guard_* nécessaire — il n'y a
-- simplement rien à garder, on ne peut rien modifier en place.

create table if not exists wishlist_items (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (customer_id, product_id)
);

comment on table wishlist_items is
  'Pièces suivies par un client du site. Écriture uniquement par wishlist_add/wishlist_remove (authenticated) ; lecture directe possible (policy ci-dessous) mais wishlist_list() est la voie normale côté front.';

create index if not exists wishlist_items_customer_created_idx on wishlist_items (customer_id, created_at desc);
create index if not exists wishlist_items_product_idx on wishlist_items (product_id);

alter table wishlist_items enable row level security;

-- Supabase accorde par défaut tous les privilèges à anon/authenticated sur un
-- nouvel objet du schéma public : on repart de zéro, comme pour web_catalogue.
revoke all on wishlist_items from anon, authenticated;
grant select on wishlist_items to authenticated;

drop policy if exists "customer_select_own" on wishlist_items;
create policy "customer_select_own" on wishlist_items for select to authenticated
  using (customer_id = (select private.current_customer_id()));

/* --------------------------------------------------------------------------
   Écriture : par slug, jamais par product_id (le front ne connaît que le slug)
   -------------------------------------------------------------------------- */

create or replace function public.wishlist_add(slug_param text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid := (select private.current_customer_id());
  v_product uuid;
  v_id uuid;
begin
  if v_customer is null then
    raise exception 'Connexion requise pour ajouter un favori';
  end if;

  select p.id into v_product
    from public.products p
   where p.web_slug = slug_param and p.web_published;

  if v_product is null then
    raise exception 'Cette pièce n''est pas disponible en ligne';
  end if;

  insert into public.wishlist_items (customer_id, product_id)
  values (v_customer, v_product)
  on conflict (customer_id, product_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.wishlist_items
     where customer_id = v_customer and product_id = v_product;
  end if;

  return v_id;
end;
$$;

revoke all on function public.wishlist_add(text) from public, anon;
grant execute on function public.wishlist_add(text) to authenticated;

create or replace function public.wishlist_remove(slug_param text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid := (select private.current_customer_id());
begin
  if v_customer is null then
    raise exception 'Connexion requise';
  end if;

  -- Pas de filtre web_published ici : un favori doit rester retirable même
  -- si la pièce a été vendue ou dépubliée entre-temps.
  delete from public.wishlist_items w
   using public.products p
   where w.product_id = p.id
     and p.web_slug = slug_param
     and w.customer_id = v_customer;
end;
$$;

revoke all on function public.wishlist_remove(text) from public, anon;
grant execute on function public.wishlist_remove(text) to authenticated;

/* --------------------------------------------------------------------------
   Lecture pré-jointe : évite un aller-retour supplémentaire côté front, et
   signale une pièce vendue/dépubliée plutôt que de la faire disparaître sans
   explication (bypass RLS volontaire, comme web_catalogue, mais scopée à
   l'appelant : ne renvoie que ses propres favoris).
   -------------------------------------------------------------------------- */

create or replace function public.wishlist_list()
returns table (
  wishlist_id uuid,
  product_id uuid,
  slug text,
  name text,
  brand_name text,
  price_ttc numeric,
  is_available boolean,
  is_published boolean,
  added_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, p.id, p.web_slug, p.name, b.name, p.cached_ttc,
         (p.status = 'en_stock'), p.web_published, w.created_at
    from public.wishlist_items w
    join public.products p on p.id = w.product_id
    left join public.brands b on b.id = p.brand_id
   where w.customer_id = (select private.current_customer_id())
   order by w.created_at desc;
$$;

revoke all on function public.wishlist_list() from public, anon;
grant execute on function public.wishlist_list() to authenticated;
