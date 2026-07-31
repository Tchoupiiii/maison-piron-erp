-- Correctif : « column reference "product_id" is ambiguous »
--
-- Les fonctions du panier déclarent des paramètres de sortie (`product_id`,
-- `slug`, `transaction_id`…) qui portent le nom de colonnes réelles. Dans une
-- requête, un nom nu peut alors désigner l'un ou l'autre, et PL/pgSQL refuse
-- de trancher — à l'exécution seulement, jamais à la création.
--
-- `web_hold_product` échouait donc systématiquement sur son `on conflict
-- (order_id, product_id)` : la clause d'inférence d'index est un contexte
-- d'expression, contrairement à la liste de colonnes d'un INSERT. Toute mise au
-- panier renvoyait une erreur.
--
-- La règle est posée une fois pour toutes avec `#variable_conflict use_column` :
-- dans une requête SQL, un nom nu désigne la colonne. Les variables de ces
-- fonctions sont toutes préfixées `v_` ou suffixées `_param`, aucune n'est donc
-- concernée — la directive est un filet, pas un changement de sens.

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

create or replace function public.web_order_status(cart_ref_param text)
returns table(
  order_id uuid,
  ref text,
  status web_order_status,
  total_ttc numeric,
  fulfilment fulfilment_mode,
  paid_at timestamptz,
  failed_reason text
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
    select o.id, o.ref, o.status, o.total_ttc, o.fulfilment_mode, o.paid_at, o.failed_reason
      from public.web_orders o
     where o.cart_ref = v_cart;
end;
$$;

revoke all on function public.web_order_status(text) from public;
grant execute on function public.web_order_status(text) to anon, authenticated;

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

  -- Chaque pièce doit toujours être retenue par CE panier. Une réservation
  -- expirée pendant que le client remplissait le formulaire, et la pièce est
  -- peut-être déjà repartie ailleurs.
  select count(*) into v_count
    from public.web_order_items i
   where i.order_id = v_order.id
     and not exists (
       select 1 from public.stock_holds h
        where h.product_id = i.product_id
          and h.cart_ref = v_cart
          and h.released_at is null);

  if v_count > 0 then
    raise exception 'Votre réservation a expiré. Reprenez votre sélection : les pièces encore disponibles peuvent être remises au panier.';
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

create or replace function public.web_confirm_paid(
  order_id_param uuid,
  mollie_payment_id_param text,
  payment_method_param payment_method default 'bancontact'
)
returns table(
  transaction_id uuid,
  transaction_ref text,
  order_ref text,
  total_amount numeric,
  already_done boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_order record;
  v_items jsonb;
  v_overrides jsonb;
  v_sale record;
  v_ref text;
  v_seq integer;
  v_prefix text := 'WEB-' || to_char(now(), 'YYYY') || '-';
  v_stale bigint;
begin
  select o.* into v_order
    from public.web_orders o where o.id = order_id_param for update;

  if v_order.id is null then
    raise exception 'Commande introuvable';
  end if;

  if v_order.transaction_id is not null then
    select t.ref into v_ref
      from public.transactions t where t.id = v_order.transaction_id;
    return query
      select v_order.transaction_id, v_ref, v_order.ref, v_order.total_ttc, true;
    return;
  end if;

  if v_order.status not in ('en_attente_paiement', 'echouee') then
    raise exception 'Commande % : état % incompatible avec un paiement',
      coalesce(v_order.ref, v_order.id::text), v_order.status;
  end if;

  -- Garantie de prix : sept jours, annoncés au client. Au-delà, on refuse
  -- plutôt que d'encaisser un montant qui ne correspond plus à rien — le
  -- webhook déclenche alors un remboursement.
  select count(*) into v_stale
    from public.web_order_items i
   where i.order_id = v_order.id
     and i.snapshot_at < now() - interval '7 days';

  if v_stale > 0 then
    raise exception 'Prix garanti expiré : la commande dépasse sept jours';
  end if;

  select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'quantity', 1)),
         jsonb_object_agg(i.product_id::text, i.unit_price_ttc_snapshot)
    into v_items, v_overrides
    from public.web_order_items i
   where i.order_id = v_order.id;

  if v_items is null then
    raise exception 'Commande sans ligne';
  end if;

  -- Le cœur repose la question du stock sous `for update` : si la pièce vient
  -- d'être vendue en boutique, il refuse. C'est le vrai risque du modèle
  -- « une ligne = un bijou » ; il se rattrape par un remboursement, il ne se
  -- masque pas.
  select * into v_sale
    from private.create_sale_core(
      v_items,
      v_order.customer_id,
      null,
      payment_method_param,
      0,
      true,
      false,
      v_order.cart_ref,
      null,
      v_overrides,
      v_order.shipping_fee_ttc);

  perform pg_advisory_xact_lock(hashtext(v_prefix));
  select coalesce(max(substring(o.ref from '[0-9]+$')::integer), 0) + 1
    into v_seq
    from public.web_orders o
   where o.ref like v_prefix || '%';
  v_ref := v_prefix || lpad(v_seq::text, 4, '0');

  update public.web_orders
     set status = 'payee',
         paid_at = now(),
         ref = v_ref,
         mollie_payment_id = coalesce(mollie_payment_id_param, mollie_payment_id),
         transaction_id = v_sale.transaction_id,
         failed_reason = null
   where id = v_order.id;

  perform private.log_web_activity(
    'web_commande_payee',
    'Commande ' || v_ref || ' payée en ligne · ' || v_sale.total_amount || ' €',
    'web_order', v_order.id, v_ref);

  return query
    select v_sale.transaction_id, v_sale.transaction_ref, v_ref, v_sale.total_amount, false;
end;
$$;

revoke all on function public.web_confirm_paid(uuid, text, payment_method)
  from public, anon, authenticated;
grant execute on function public.web_confirm_paid(uuid, text, payment_method) to service_role;
