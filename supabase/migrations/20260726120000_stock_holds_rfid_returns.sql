-- Stock, réservations et retours — la garantie vit dans la base
--
-- Trois exigences, une seule mécanique :
--
-- 1. « Ça doit être impossible d'être en stock négatif. » Les pièces de la
--    maison sont uniques : une ligne `products` = un bijou. Le stock négatif est
--    donc impossible *par construction* à condition que la transition vers
--    `vendu` soit sérialisée. C'est ce que fait `select ... for update` :
--    si la boutique et le site encaissent la même pièce à la même seconde, la
--    seconde transaction attend, relit le statut et échoue proprement.
--
-- 2. « Scanné mais pas payé, ça n'enlève pas le stock. » Le scan pose une
--    *réservation* (`stock_holds`) à durée de vie courte, pas une vente. La
--    pièce reste `en_stock` ; elle disparaît seulement des pièces *disponibles*.
--    Panier abandonné → la réservation expire et la pièce revient d'elle-même.
--
-- 3. « Si retour, ça rajoute. » `return_sold_item` émet une note de crédit et
--    remet la pièce en stock. La vente d'origine n'est jamais modifiée :
--    obligation de conservation (art. 60 CTVA).

create type stock_movement_kind as enum (
  'entree',       -- mise en stock
  'reservation',  -- scan ou panier web, rien n'est encore vendu
  'liberation',   -- panier abandonné, annulé ou expiré
  'vente',        -- payé : c'est ici, et seulement ici, que le stock baisse
  'retour'        -- note de crédit : le stock remonte
);

-- Puces RFID : une pièce peut porter un code-barres, une puce, ou les deux.
alter table products add column if not exists rfid_tag text;
create unique index if not exists products_rfid_tag_key
  on products (upper(rfid_tag)) where rfid_tag is not null;

comment on column products.rfid_tag is
  'Identifiant de puce RFID (EPC). Un lecteur RFID en mode clavier tape ce code comme un scanner de code-barres.';

-- Les caisses RFID existent (lecteurs de comptoir EPC UHF, badges 13,56 MHz).
-- Presque tous savent se comporter en clavier ; le mode est purement indicatif.
alter table pos_terminals drop constraint if exists pos_terminals_scanner_mode_check;
alter table pos_terminals add constraint pos_terminals_scanner_mode_check
  check (scanner_mode in ('clavier', 'camera', 'rfid'));

/* --------------------------------------------------------------------------
   Réservations
   -------------------------------------------------------------------------- */

create table if not exists stock_holds (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  channel text not null check (channel in ('boutique', 'en_ligne')),
  cart_ref text not null,
  terminal_id uuid references pos_terminals (id) on delete set null,
  held_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz,
  release_reason text
);

-- LE verrou métier : une seule réservation vivante par pièce, tous canaux
-- confondus. Un index unique partiel, donc arbitré par PostgreSQL lui-même —
-- pas par du code applicatif qui peut être contourné ou perdre une course.
create unique index if not exists stock_holds_one_live_per_product
  on stock_holds (product_id) where released_at is null;

create index if not exists stock_holds_cart_idx on stock_holds (cart_ref)
  where released_at is null;

create table if not exists stock_movements (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  product_id uuid not null references products (id) on delete cascade,
  kind stock_movement_kind not null,
  channel text,
  cart_ref text,
  transaction_id uuid references transactions (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  note text
);

create index if not exists stock_movements_product_idx
  on stock_movements (product_id, occurred_at desc);

alter table stock_holds enable row level security;
alter table stock_movements enable row level security;

-- Lecture pour qui consulte les ventes ; aucune écriture directe : tout passe
-- par les fonctions ci-dessous, sinon la réservation ne vaudrait rien.
create policy "staff_select" on stock_holds for select to authenticated
  using ((select private.has_permission('ventes.voir')));
create policy "staff_select" on stock_movements for select to authenticated
  using ((select private.has_permission('inventaire.voir')));

/* --------------------------------------------------------------------------
   Disponibilité
   -------------------------------------------------------------------------- */

-- Ce que le site web doit interroger : `is_available`, pas `status`.
-- Une pièce réservée reste en stock — elle n'est simplement plus vendable.
create or replace view public.product_availability
with (security_invoker = true) as
  select p.id,
         p.sku,
         p.rfid_tag,
         p.name,
         p.status,
         p.cached_ttc,
         (p.status = 'en_stock' and h.id is null) as is_available,
         h.channel   as held_channel,
         h.cart_ref  as held_cart,
         h.expires_at as held_until
    from public.products p
    left join public.stock_holds h
      on h.product_id = p.id
     and h.released_at is null
     and h.expires_at > now();

comment on view public.product_availability is
  'Source de vérité de la vente en ligne : is_available tient compte des paniers en cours, en boutique comme sur le site.';

/* --------------------------------------------------------------------------
   Fonctions
   -------------------------------------------------------------------------- */

/** Balaye les réservations périmées. Appelée au début de chaque scan. */
create or replace function public.release_expired_holds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.stock_holds
       set released_at = now(), release_reason = 'expiration'
     where released_at is null and expires_at <= now()
     returning product_id, channel, cart_ref
  )
  insert into public.stock_movements (product_id, kind, channel, cart_ref, note)
  select product_id, 'liberation', channel, cart_ref, 'Réservation expirée'
    from expired;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/** Résout un code scanné : SKU code-barres ou puce RFID, indifféremment. */
create or replace function private.resolve_product_code(code_param text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.products p
   where upper(p.sku) = upper(trim(code_param))
      or upper(p.rfid_tag) = upper(trim(code_param))
   limit 1;
$$;

/**
 * Le geste du scan, en boutique comme sur le site.
 *
 * Ne vend rien, ne décrémente rien : pose une réservation courte et rend la
 * pièce avec son prix du jour. Si la pièce est déjà dans un autre panier ou
 * déjà vendue, la fonction refuse — c'est le « il y en a 1 de refusé ».
 */
create or replace function public.scan_product(
  code_param text,
  cart_ref_param text,
  channel_param text default 'boutique',
  terminal_id_param uuid default null,
  minutes_param integer default 30
)
returns table (
  product_id uuid,
  sku text,
  name text,
  price_ttc numeric,
  hold_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_product record;
  v_hold record;
  v_price record;
  v_expires timestamptz := now() + make_interval(mins => greatest(coalesce(minutes_param, 30), 1));
begin
  if not private.has_permission('ventes.creer') then
    raise exception 'Vous n''avez pas le droit d''encaisser une vente';
  end if;

  if coalesce(trim(cart_ref_param), '') = '' then
    raise exception 'Panier non identifié';
  end if;

  perform public.release_expired_holds();

  v_id := private.resolve_product_code(code_param);
  if v_id is null then
    raise exception 'Aucune pièce ne porte le code %', trim(code_param);
  end if;

  -- Le verrou : toute autre caisse qui scanne la même pièce attend ici.
  select p.id, p.sku, p.name, p.status into v_product
    from public.products p where p.id = v_id for update;

  if v_product.status = 'vendu' then
    raise exception '% est déjà vendue', v_product.name;
  end if;

  select h.cart_ref, h.channel into v_hold
    from public.stock_holds h
   where h.product_id = v_id and h.released_at is null;

  if v_hold.cart_ref is not null and v_hold.cart_ref = cart_ref_param then
    raise exception '% est déjà dans ce panier', v_product.name;
  end if;

  if v_hold.cart_ref is not null then
    raise exception '% est réservée par un autre panier (%)',
      v_product.name,
      case when v_hold.channel = 'en_ligne' then 'commande en ligne' else 'autre caisse' end;
  end if;

  select * into v_price from public.calculate_dynamic_price(v_id);
  if v_price.has_missing_rate then
    raise exception 'Cours du métal manquant pour % : synchronisez avant de vendre', v_product.sku;
  end if;

  insert into public.stock_holds (
    product_id, channel, cart_ref, terminal_id, held_by, expires_at
  ) values (
    v_id,
    case when channel_param = 'en_ligne' then 'en_ligne' else 'boutique' end,
    cart_ref_param, terminal_id_param, (select auth.uid()), v_expires
  );

  insert into public.stock_movements (product_id, kind, channel, cart_ref, actor_id, note)
  values (v_id, 'reservation', channel_param, cart_ref_param, (select auth.uid()),
          'Pièce scannée, non payée');

  return query select v_id, v_product.sku, v_product.name, v_price.ttc, v_expires;
end;
$$;

/**
 * Libère une pièce (retirée du panier) ou tout un panier (vente abandonnée).
 * Le stock n'ayant jamais bougé, il n'y a rien à « remettre » : on rouvre
 * simplement la pièce à la vente.
 */
create or replace function public.release_hold(
  cart_ref_param text,
  product_id_param uuid default null,
  reason_param text default 'abandon'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.has_permission('ventes.creer') then
    raise exception 'Vous n''avez pas le droit de modifier un panier';
  end if;

  with released as (
    update public.stock_holds h
       set released_at = now(), release_reason = reason_param
     where h.cart_ref = cart_ref_param
       and h.released_at is null
       and (product_id_param is null or h.product_id = product_id_param)
     returning h.product_id, h.channel, h.cart_ref
  )
  insert into public.stock_movements (product_id, kind, channel, cart_ref, actor_id, note)
  select product_id, 'liberation', channel, cart_ref, (select auth.uid()), reason_param
    from released;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/* --------------------------------------------------------------------------
   Vente : la seule écriture qui fait baisser le stock
   -------------------------------------------------------------------------- */

drop function if exists public.create_sale(jsonb, uuid, uuid, public.payment_method, numeric, boolean, boolean);

create function public.create_sale(
  items_param jsonb,
  customer_id_param uuid default null,
  terminal_id_param uuid default null,
  payment_method_param public.payment_method default null,
  discount_param numeric default 0,
  mark_paid_param boolean default false,
  emit_invoice_param boolean default false,
  cart_ref_param text default null
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
  v_hold record;
  v_channel text;
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

  perform public.release_expired_holds();

  -- Le canal vient de la réservation en cours : c'est elle qui sait d'où part
  -- la vente, mieux que la présence d'une caisse.
  v_channel := case when terminal_id_param is null then 'en_ligne' else 'boutique' end;

  for v_item in select * from jsonb_array_elements(items_param) loop
    v_qty := coalesce((v_item ->> 'quantity')::integer, 1);
    if v_qty <= 0 then
      raise exception 'Quantité invalide';
    end if;

    if v_item ? 'product_id' and (v_item ->> 'product_id') is not null then
      -- `for update` sérialise deux encaissements concurrents de la même
      -- pièce : le second attend ici, puis relit `status` et échoue.
      select p.id, p.sku, p.name, p.status into v_product
        from public.products p
       where p.id = (v_item ->> 'product_id')::uuid
         for update;

      if v_product.id is null then
        raise exception 'Pièce introuvable';
      end if;
      if v_product.status = 'vendu' then
        raise exception '% est déjà vendue', v_product.name;
      end if;

      -- Une pièce réservée par un autre panier n'est pas vendable ici, même
      -- si son statut la dit encore en stock.
      select h.cart_ref, h.channel into v_hold
        from public.stock_holds h
       where h.product_id = v_product.id and h.released_at is null;

      if v_hold.cart_ref is not null
         and (cart_ref_param is null or v_hold.cart_ref <> cart_ref_param) then
        raise exception '% est réservée par un autre panier', v_product.name;
      end if;
      if v_hold.channel is not null then
        v_channel := v_hold.channel;
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

    -- La réservation a fait son travail : elle devient une vente.
    update public.stock_holds
       set released_at = now(), release_reason = 'vente'
     where product_id = any (v_sold) and released_at is null;

    insert into public.stock_movements (
      product_id, kind, channel, cart_ref, transaction_id, actor_id, note
    )
    select unnest(v_sold), 'vente', v_channel, cart_ref_param, v_tx, (select auth.uid()),
           'Encaissement ' || coalesce(v_ref, 'brouillon');
  end if;

  return query select v_tx, v_ref, v_total;
end;
$$;

/* --------------------------------------------------------------------------
   Retour
   -------------------------------------------------------------------------- */

/**
 * Retour d'une pièce vendue : note de crédit + remise en stock.
 *
 * La vente d'origine n'est ni modifiée ni supprimée — c'est une obligation
 * comptable. Le retour est un document distinct, à montant négatif, numéroté
 * `AV-` (avoir).
 */
create or replace function public.return_sold_item(
  transaction_item_id_param uuid,
  reason_param text default null
)
returns table (credit_note_id uuid, credit_note_ref text, amount numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line record;
  v_tx uuid;
  v_ref text;
  v_seq integer;
  v_prefix text := 'AV-' || to_char(now(), 'YYYY') || '-';
  v_amount numeric;
begin
  if not private.has_permission('ventes.retour') then
    raise exception 'Vous n''avez pas le droit d''enregistrer un retour';
  end if;

  select ti.id, ti.product_id, ti.description, ti.unit_price_ht, ti.quantity,
         ti.line_total_ttc, t.customer_id, t.terminal_id, t.ref as origin_ref,
         t.status as origin_status
    into v_line
    from public.transaction_items ti
    join public.transactions t on t.id = ti.transaction_id
   where ti.id = transaction_item_id_param;

  if v_line.id is null then
    raise exception 'Ligne de vente introuvable';
  end if;
  if v_line.product_id is null then
    raise exception 'Seule une pièce peut être retournée, pas une réparation';
  end if;
  if v_line.origin_status = 'annulee' then
    raise exception 'Cette vente est déjà annulée';
  end if;
  if exists (
    select 1 from public.stock_movements m
     where m.product_id = v_line.product_id and m.kind = 'retour'
       and m.note like '%' || v_line.origin_ref || '%'
  ) then
    raise exception 'Cette pièce a déjà fait l''objet d''un retour';
  end if;

  v_amount := coalesce(v_line.line_total_ttc, 0);

  perform pg_advisory_xact_lock(hashtext(v_prefix));
  select coalesce(max(substring(t.ref from '[0-9]+$')::integer), 0) + 1
    into v_seq
    from public.transactions t
   where t.ref like v_prefix || '%';
  v_ref := v_prefix || lpad(v_seq::text, 4, '0');

  insert into public.transactions (
    ref, customer_id, terminal_id, status, total_amount, amount_paid,
    issued_at, created_by
  ) values (
    v_ref, v_line.customer_id, v_line.terminal_id, 'payee',
    -v_amount, -v_amount, now(), (select auth.uid())
  )
  returning id into v_tx;

  insert into public.transaction_items (
    transaction_id, product_id, description, unit_price_ht, quantity
  ) values (
    v_tx, v_line.product_id,
    'Retour · ' || v_line.description || ' (vente ' || v_line.origin_ref || ')',
    -v_line.unit_price_ht, v_line.quantity
  );

  -- La pièce redevient vendable, en boutique comme en ligne.
  update public.products
     set status = 'en_stock', sold_at = null
   where id = v_line.product_id;

  insert into public.stock_movements (
    product_id, kind, transaction_id, actor_id, note
  ) values (
    v_line.product_id, 'retour', v_tx, (select auth.uid()),
    coalesce(reason_param, 'Retour client') || ' · vente ' || v_line.origin_ref
  );

  return query select v_tx, v_ref, v_amount;
end;
$$;

/* --------------------------------------------------------------------------
   Permission de retour
   -------------------------------------------------------------------------- */

insert into permission_catalogue (key, category, label, description, sort)
values ('ventes.retour', 'Ventes', 'Enregistrer un retour',
        'Émettre une note de crédit et remettre une pièce en stock', 45)
on conflict (key) do nothing;

-- Un retour rend de l'argent : réservé au gemmologue par défaut, l'admin l'a
-- toujours. Une vendeuse peut l'obtenir par exception nominative.
insert into role_permissions (role, permission_key)
values ('gemmologue', 'ventes.retour')
on conflict do nothing;

-- Une note de crédit porte des montants négatifs : c'est ce qui la fait se
-- soustraire de tous les totaux sans code d'exception ailleurs. Les ventes
-- ordinaires restent interdites de négatif.
alter table transactions drop constraint if exists transactions_amount_paid_check;
alter table transactions add constraint transactions_amount_paid_check
  check (case when ref like 'AV-%' then amount_paid <= 0 else amount_paid >= 0 end);

alter table transactions drop constraint if exists transactions_total_amount_sign_check;
alter table transactions add constraint transactions_total_amount_sign_check
  check (case when ref like 'AV-%' then total_amount <= 0 else total_amount >= 0 end);
