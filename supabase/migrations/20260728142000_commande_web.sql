-- Panier et commande en ligne
--
-- `web_orders` est le sas avant la comptabilité. Un panier abandonné ou un
-- paiement échoué ne doit laisser aucune trace dans `transactions` : la
-- conservation belge (art. 60 CTVA) interdit d'y supprimer quoi que ce soit,
-- donc on n'y écrit qu'une vente réellement encaissée.
--
-- Le panier web réutilise `stock_holds` — le même verrou que la caisse. Une
-- pièce retenue en ligne est indisponible en boutique, et réciproquement :
-- c'est le seul moyen de ne pas vendre deux fois un bijou unique.

create type fulfilment_mode as enum ('retrait_boutique', 'envoi_belgique');

create type web_order_status as enum (
  'panier', 'en_attente_paiement', 'payee', 'echouee', 'expiree', 'remboursee');

create table if not exists web_orders (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  cart_ref text not null unique,
  customer_id uuid references customers (id) on delete set null,
  status web_order_status not null default 'panier',
  fulfilment_mode fulfilment_mode not null default 'retrait_boutique',
  contact_email text,
  contact_name text,
  contact_phone text,
  shipping_street text,
  shipping_postal_code text,
  shipping_city text,
  shipping_country text not null default 'BE',
  shipping_fee_ttc numeric(12, 2) not null default 0,
  subtotal_ttc numeric(12, 2) not null default 0,
  total_ttc numeric(12, 2) not null default 0,
  mollie_payment_id text unique,
  paid_at timestamptz,
  failed_reason text,
  refunded_at timestamptz,
  transaction_id uuid references transactions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);

comment on table web_orders is
  'Commande en ligne, de la mise au panier au paiement. Devient une `transactions` seulement une fois payée — avant, rien n''est comptable.';
comment on column web_orders.cart_ref is
  'Jeton porteur du panier, dans un cookie httpOnly. Format WEB-<uuid> imposé par `web_hold_product` : sans ce contrôle, un visiteur pourrait présenter le cart_ref d''une caisse et s''approprier son panier.';
comment on column web_orders.ref is
  'Référence client (WEB-AAAA-nnnn), attribuée au paiement. Distincte de `transactions.ref` (TIC-/FA-), qui reste la pièce comptable.';

create index if not exists web_orders_status_idx on web_orders (status, created_at desc);
create index if not exists web_orders_customer_idx on web_orders (customer_id);

drop trigger if exists trg_web_orders_updated_at on web_orders;
create trigger trg_web_orders_updated_at
  before update on web_orders
  for each row execute function private.touch_updated_at();

create table if not exists web_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references web_orders (id) on delete cascade,
  product_id uuid not null references products (id) on delete restrict,
  unit_price_ttc_snapshot numeric(12, 2) not null,
  snapshot_at timestamptz not null default now(),
  unique (order_id, product_id)
);

comment on column web_order_items.unit_price_ttc_snapshot is
  'Prix affiché au moment de la mise au panier. Le cours de l''or bouge ; la Maison garantit son prix sept jours. Sans cette photo horodatée, le client paierait un montant et la vente en enregistrerait un autre.';

alter table web_orders enable row level security;
alter table web_order_items enable row level security;

insert into permission_catalogue (key, category, label, description, sort) values
  ('web.commandes', 'Site web', 'Suivre les commandes en ligne',
   'Consulter les commandes du site : en attente, payées, échouées, remboursées.', 30),
  ('web.demandes', 'Site web', 'Traiter les demandes du site',
   'Lire et clôturer les demandes de rendez-vous, questions et estimations reçues en ligne.', 40)
on conflict (key) do nothing;

-- La vendeuse est en première ligne sur une commande à préparer et sur une
-- demande de rendez-vous. Publier une pièce reste au gemmologue.
insert into role_permissions (role, permission_key) values
  ('gemmologue', 'web.commandes'),
  ('gemmologue', 'web.demandes'),
  ('vendeuse', 'web.commandes'),
  ('vendeuse', 'web.demandes')
on conflict do nothing;

-- Aucune policy pour anon : le panier ne se lit pas en direct, il passe par des
-- fonctions qui exigent le cart_ref. Le personnel voit les commandes web dans
-- l'ERP ; le client connecté retrouve les siennes.
create policy "staff_select" on web_orders for select to authenticated
  using ((select private.has_permission('web.commandes')));
create policy "customer_select_own" on web_orders for select to authenticated
  using (customer_id = (select private.current_customer_id()));

create policy "staff_select" on web_order_items for select to authenticated
  using ((select private.has_permission('web.commandes')));
create policy "customer_select_own" on web_order_items for select to authenticated
  using (exists (
    select 1 from public.web_orders o
     where o.id = web_order_items.order_id
       and o.customer_id = (select private.current_customer_id())
  ));

/* --------------------------------------------------------------------------
   Journal des actions sans employé
   -------------------------------------------------------------------------- */

-- `log_activity` exige une session employé, à raison : c'est elle qui empêche
-- de forger une ligne depuis le client. Le site n'a pas d'employé — d'où cette
-- porte séparée, `private`, sans aucun grant : seules les fonctions security
-- definer de ce fichier l'appellent. `activity_log` conserve ainsi son
-- invariant : aucune policy d'insertion, jamais.
create or replace function private.log_web_activity(
  action_param activity_action,
  summary_param text,
  entity_type_param text default null,
  entity_id_param uuid default null,
  entity_label_param text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activity_log (
    actor_id, actor_name, actor_role, action, entity_type, entity_id,
    entity_label, summary
  ) values (
    null, 'Site web', null, action_param, entity_type_param, entity_id_param,
    entity_label_param, summary_param
  );
$$;

revoke all on function private.log_web_activity(activity_action, text, text, uuid, text)
  from public, anon, authenticated;

/* --------------------------------------------------------------------------
   Réservation depuis le site
   -------------------------------------------------------------------------- */

-- Le cart_ref est un jeton porteur : le connaître, c'est disposer du panier.
-- Il est donc généré côté serveur et confiné à ce format, pour qu'un visiteur
-- ne puisse pas présenter celui d'une caisse.
create or replace function private.assert_web_cart_ref(cart_ref_param text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if cart_ref_param !~ '^WEB-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'Panier non identifié';
  end if;
  return cart_ref_param;
end;
$$;

revoke all on function private.assert_web_cart_ref(text) from public, anon, authenticated;

-- Même verrou que `scan_product`, sans exiger de permission staff : c'est le
-- cart_ref qui autorise, pas un compte. Soixante minutes contre trente en
-- boutique — le tunnel de paiement en ligne est plus long qu'un passage en
-- caisse, et un client qui saisit sa carte ne doit pas voir sa pièce lui
-- échapper.
create or replace function public.web_hold_product(
  slug_param text,
  cart_ref_param text
)
returns table(
  product_id uuid,
  slug text,
  name text,
  price_ttc numeric,
  hold_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart text := private.assert_web_cart_ref(cart_ref_param);
  v_product record;
  v_hold record;
  v_order record;
  v_order_id uuid;
  v_expires timestamptz := now() + interval '60 minutes';
begin
  perform public.release_expired_holds();

  -- Un cart_ref ne sert qu'à un panier. Passé en paiement, il est clos : le
  -- site doit en générer un nouveau plutôt que de rouvrir une commande dont
  -- un paiement est peut-être en vol.
  select o.id, o.status into v_order
    from public.web_orders o where o.cart_ref = v_cart for update;

  if v_order.id is not null and v_order.status <> 'panier' then
    raise exception 'Ce panier est clos. Rechargez la page pour en ouvrir un nouveau.'
      using errcode = 'invalid_parameter_value';
  end if;

  select p.id, p.name, p.web_slug, p.status, p.cached_ttc, p.supply_mode
    into v_product
    from public.products p
   where p.web_slug = slug_param and p.web_published
     for update;

  if v_product.id is null then
    raise exception 'Cette pièce n''est pas disponible en ligne';
  end if;
  if v_product.status = 'vendu' then
    raise exception '% vient d''être vendue', v_product.name;
  end if;
  if v_product.supply_mode = 'sur_demande' then
    raise exception '% se commande auprès de la Maison, pas en ligne', v_product.name;
  end if;
  if v_product.cached_ttc is null then
    raise exception 'Le prix de % n''est pas encore établi', v_product.name;
  end if;

  select h.cart_ref, h.expires_at into v_hold
    from public.stock_holds h
   where h.product_id = v_product.id and h.released_at is null;

  -- Déjà dans ce panier : l'appel est rejoué (double clic, retour arrière).
  if v_hold.cart_ref is not null and v_hold.cart_ref = v_cart then
    return query
      select v_product.id, v_product.web_slug, v_product.name,
             v_product.cached_ttc, v_hold.expires_at;
    return;
  end if;

  if v_hold.cart_ref is not null then
    raise exception '% est en cours d''achat par quelqu''un d''autre. Elle redevient disponible sous une heure si la vente ne se conclut pas.', v_product.name;
  end if;

  insert into public.stock_holds (product_id, channel, cart_ref, expires_at)
  values (v_product.id, 'en_ligne', v_cart, v_expires);

  insert into public.stock_movements (product_id, kind, channel, cart_ref, note)
  values (v_product.id, 'reservation', 'en_ligne', v_cart, 'Mise au panier sur le site');

  insert into public.web_orders (cart_ref, expires_at)
  values (v_cart, v_expires)
  on conflict (cart_ref) do update
    set expires_at = greatest(web_orders.expires_at, excluded.expires_at)
  returning id into v_order_id;

  insert into public.web_order_items (order_id, product_id, unit_price_ttc_snapshot)
  values (v_order_id, v_product.id, v_product.cached_ttc)
  on conflict (order_id, product_id) do nothing;

  return query
    select v_product.id, v_product.web_slug, v_product.name, v_product.cached_ttc, v_expires;
end;
$$;

revoke all on function public.web_hold_product(text, text) from public;
grant execute on function public.web_hold_product(text, text) to anon, authenticated;

create or replace function public.web_release(
  cart_ref_param text,
  product_id_param uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart text := private.assert_web_cart_ref(cart_ref_param);
  v_count integer;
begin
  with released as (
    update public.stock_holds h
       set released_at = now(), release_reason = 'abandon'
     where h.cart_ref = v_cart
       and h.released_at is null
       and (product_id_param is null or h.product_id = product_id_param)
     returning h.product_id, h.channel, h.cart_ref
  )
  insert into public.stock_movements (product_id, kind, channel, cart_ref, note)
  select product_id, 'liberation', channel, cart_ref, 'Retiré du panier sur le site'
    from released;

  get diagnostics v_count = row_count;

  delete from public.web_order_items i
   using public.web_orders o
   where i.order_id = o.id
     and o.cart_ref = v_cart
     and o.status = 'panier'
     and (product_id_param is null or i.product_id = product_id_param);

  return v_count;
end;
$$;

revoke all on function public.web_release(text, uuid) from public;
grant execute on function public.web_release(text, uuid) to anon, authenticated;

-- Le panier n'est lisible par aucune policy : le cart_ref est la seule clé.
-- Le prix courant est renvoyé à côté du prix figé pour que l'écart, s'il
-- existe, soit visible du client plutôt que découvert à l'encaissement.
create or replace function public.web_cart(cart_ref_param text)
returns table(
  product_id uuid,
  slug text,
  name text,
  brand_name text,
  price_ttc numeric,
  current_ttc numeric,
  snapshot_at timestamptz,
  hold_expires_at timestamptz,
  still_held boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart text := private.assert_web_cart_ref(cart_ref_param);
begin
  perform public.release_expired_holds();

  return query
    select p.id, p.web_slug, p.name, b.name,
           i.unit_price_ttc_snapshot, p.cached_ttc, i.snapshot_at,
           h.expires_at, (h.id is not null)
      from public.web_orders o
      join public.web_order_items i on i.order_id = o.id
      join public.products p on p.id = i.product_id
      left join public.brands b on b.id = p.brand_id
      left join public.stock_holds h
        on h.product_id = p.id and h.cart_ref = v_cart and h.released_at is null
     where o.cart_ref = v_cart
       and o.status in ('panier', 'en_attente_paiement')
     order by i.snapshot_at;
end;
$$;

revoke all on function public.web_cart(text) from public;
grant execute on function public.web_cart(text) to anon, authenticated;
