-- Le panier web ne réserve plus rien : seul le paiement retient une pièce
--
-- Jusqu'ici, `web_hold_product` posait un `stock_holds` de 60 minutes dès la
-- mise au panier, exactement comme un scan en boutique. Décision produit :
-- un panier web abandonné ne doit avoir *aucun* effet sur la disponibilité
-- d'une pièce, en boutique comme en ligne. Seul `create_sale_core` — appelé
-- au moment réel du paiement, boutique ou `web_confirm_paid` — peut faire
-- passer une pièce à `vendu`. Le risque assumé : un paiement Mollie confirmé
-- une seconde trop tard sur une pièce vendue entre-temps échoue et se
-- rattrape par un remboursement, plutôt que par une réservation qui aurait
-- affiché « indisponible » à tort pendant toute une navigation.
--
-- `web_hold_product` garde son nom (le site en dépend), mais ne pose plus de
-- verrou : c'est une mise au panier, pas une réservation. Pareil pour
-- `web_cart` (plus de jointure sur `stock_holds`) et `web_release` (plus rien
-- à libérer). `web_begin_checkout` vérifie la disponibilité en temps réel au
-- lieu d'exiger une réservation qui n'existe plus.
--
-- Côté boutique, le délai par défaut d'un scan passe de 30 à 15 minutes.

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
#variable_conflict use_column
declare
  v_cart text := private.assert_web_cart_ref(cart_ref_param);
  v_product record;
  v_order record;
  v_order_id uuid;
  v_item record;
begin
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
   where p.web_slug = slug_param and p.web_published;

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

  insert into public.web_orders (cart_ref)
  values (v_cart)
  on conflict (cart_ref) do nothing
  returning id into v_order_id;

  if v_order_id is null then
    select id into v_order_id from public.web_orders where cart_ref = v_cart;
  end if;

  -- Le prix affiché est photographié une seule fois : un second ajout de la
  -- même pièce ne le rafraîchit pas, la garantie sept jours porte sur ce cliché.
  insert into public.web_order_items (order_id, product_id, unit_price_ttc_snapshot)
  values (v_order_id, v_product.id, v_product.cached_ttc)
  on conflict (order_id, product_id) do nothing;

  select i.unit_price_ttc_snapshot, i.snapshot_at into v_item
    from public.web_order_items i
   where i.order_id = v_order_id and i.product_id = v_product.id;

  return query
    select v_product.id, v_product.web_slug, v_product.name,
           v_item.unit_price_ttc_snapshot, v_item.snapshot_at + interval '7 days';
end;
$$;

revoke all on function public.web_hold_product(text, text) from public;
grant execute on function public.web_hold_product(text, text) to anon, authenticated;

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
#variable_conflict use_column
declare
  v_cart text := private.assert_web_cart_ref(cart_ref_param);
begin
  return query
    select p.id, p.web_slug, p.name, b.name,
           i.unit_price_ttc_snapshot, p.cached_ttc, i.snapshot_at,
           i.snapshot_at + interval '7 days',
           (p.status <> 'vendu')
      from public.web_orders o
      join public.web_order_items i on i.order_id = o.id
      join public.products p on p.id = i.product_id
      left join public.brands b on b.id = p.brand_id
     where o.cart_ref = v_cart
       and o.status in ('panier', 'en_attente_paiement')
     order by i.snapshot_at;
end;
$$;

revoke all on function public.web_cart(text) from public;
grant execute on function public.web_cart(text) to anon, authenticated;

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
  delete from public.web_order_items i
   using public.web_orders o
   where i.order_id = o.id
     and o.cart_ref = v_cart
     and o.status = 'panier'
     and (product_id_param is null or i.product_id = product_id_param);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.web_release(text, uuid) from public;
grant execute on function public.web_release(text, uuid) to anon, authenticated;

create or replace function public.web_begin_checkout(
  cart_ref_param text,
  fulfilment_param fulfilment_mode,
  shipping_fee_param numeric,
  contact_name_param text default null,
  contact_email_param text default null,
  contact_phone_param text default null,
  street_param text default null,
  postal_code_param text default null,
  city_param text default null
)
returns table(order_id uuid, subtotal_ttc numeric, shipping_ttc numeric, total_ttc numeric)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_cart text := private.assert_web_cart_ref(cart_ref_param);
  v_customer uuid := (select private.current_customer_id());
  v_order record;
  v_subtotal numeric;
  v_shipping numeric;
  v_count integer;
  v_unavailable text;
begin
  if v_customer is null then
    raise exception 'Connexion requise pour commander';
  end if;

  perform public.release_expired_holds();

  select o.* into v_order from public.web_orders o where o.cart_ref = v_cart for update;
  if v_order.id is null then
    raise exception 'Panier introuvable';
  end if;
  if v_order.status not in ('panier', 'en_attente_paiement') then
    raise exception 'Ce panier est clos';
  end if;

  -- Le panier ne réserve rien : entre la mise au panier et le paiement, une
  -- pièce a pu être vendue ou retenue par un scan en boutique. On le vérifie
  -- ici pour éviter d'envoyer le client payer une pièce vouée à l'échec ;
  -- `create_sale_core` retranche la décision définitive sous verrou au
  -- moment réel du paiement.
  select p.name into v_unavailable
    from public.web_order_items i
    join public.products p on p.id = i.product_id
   where i.order_id = v_order.id
     and (
       p.status = 'vendu'
       or exists (
         select 1 from public.stock_holds h
          where h.product_id = i.product_id and h.released_at is null
       )
     )
   limit 1;

  if v_unavailable is not null then
    raise exception '% n''est plus disponible. Reprenez votre sélection.', v_unavailable;
  end if;

  select coalesce(sum(i.unit_price_ttc_snapshot), 0), count(*)
    into v_subtotal, v_count
    from public.web_order_items i where i.order_id = v_order.id;

  if v_count = 0 then
    raise exception 'Panier vide';
  end if;

  v_shipping := case
    when fulfilment_param = 'envoi_belgique' then round(coalesce(shipping_fee_param, 0), 2)
    else 0
  end;

  update public.web_orders
     set status = 'en_attente_paiement',
         customer_id = v_customer,
         fulfilment_mode = fulfilment_param,
         contact_name = nullif(trim(contact_name_param), ''),
         contact_email = nullif(lower(trim(contact_email_param)), ''),
         contact_phone = nullif(trim(contact_phone_param), ''),
         shipping_street = case when fulfilment_param = 'envoi_belgique'
                                then nullif(trim(street_param), '') end,
         shipping_postal_code = case when fulfilment_param = 'envoi_belgique'
                                     then nullif(trim(postal_code_param), '') end,
         shipping_city = case when fulfilment_param = 'envoi_belgique'
                              then nullif(trim(city_param), '') end,
         shipping_fee_ttc = v_shipping,
         subtotal_ttc = v_subtotal,
         total_ttc = round(v_subtotal + v_shipping, 2)
   where id = v_order.id;

  return query
    select v_order.id, v_subtotal, v_shipping, round(v_subtotal + v_shipping, 2);
end;
$$;

revoke all on function public.web_begin_checkout(
  text, fulfilment_mode, numeric, text, text, text, text, text, text) from public, anon;
grant execute on function public.web_begin_checkout(
  text, fulfilment_mode, numeric, text, text, text, text, text, text) to authenticated;

-- Boutique : un panier non conclu se rouvre après 15 minutes, plus 30. La
-- borne 1 min – 24 h posée par `bound_hold_duration` reste inchangée.
create or replace function public.scan_product(
  code_param text,
  cart_ref_param text,
  channel_param text default 'boutique',
  terminal_id_param uuid default null,
  minutes_param integer default 15
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
  v_expires timestamptz :=
    now() + make_interval(mins => least(greatest(coalesce(minutes_param, 15), 1), 1440));
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

revoke all on function public.scan_product(text, text, text, uuid, integer) from public, anon;
grant execute on function public.scan_product(text, text, text, uuid, integer) to authenticated;

-- Geste admin distinct du panier normal ("abandon"/"vente"/"expiration") :
-- traçable séparément dans le journal d'activité.
alter type activity_action add value if not exists 'panier_libere';
