-- Une seule implémentation de la vente, pour la caisse, l'ERP et le site
--
-- `create_sale` commence par exiger `ventes.creer` — une permission d'employé,
-- que le site n'aura jamais. Trois issues étaient possibles : un faux compte
-- employé pour le site (une identité fictive dans le journal et dans
-- `transactions.created_by`), une seconde implémentation de la vente pour le
-- web (deux verrous de concurrence à maintenir en parallèle, sur la seule
-- opération qu'on ne peut pas se permettre de rater), ou l'extraction du corps.
--
-- C'est la troisième : `private.create_sale_core` porte la logique — verrou
-- `for update`, contrôle des réservations, numérotation, mouvements de stock —
-- sans aucun contrôle de permission ; `public.create_sale` redevient un mince
-- gardien qui vérifie le droit puis délègue. Le canal web appelle le cœur
-- directement, après confirmation du paiement.
--
-- `create or replace` conserve les droits d'exécution existants tant que la
-- signature ne bouge pas ; celle de `create_sale` est inchangée, à dessein.
-- Vérifier malgré tout avec `get_advisors(type:"security")` :
-- `drop`+`create` d'une fonction remet ses droits au défaut PUBLIC, et cette
-- base s'est déjà fait prendre.

/* --------------------------------------------------------------------------
   Le cœur
   -------------------------------------------------------------------------- */

-- AUCUN contrôle de permission ici, volontairement : c'est l'appelant qui
-- répond de l'autorisation. D'où `private` et zéro grant — seules des fonctions
-- security definer propriété de `postgres` peuvent l'atteindre.
create or replace function private.create_sale_core(
  items_param jsonb,
  customer_id_param uuid default null,
  terminal_id_param uuid default null,
  payment_method_param payment_method default null,
  discount_param numeric default 0,
  mark_paid_param boolean default false,
  emit_invoice_param boolean default false,
  cart_ref_param text default null,
  actor_id_param uuid default null,
  price_overrides_param jsonb default null,
  shipping_ttc_param numeric default 0
)
returns table(transaction_id uuid, transaction_ref text, total_amount numeric)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_product record;
  v_ticket record;
  v_price record;
  v_hold record;
  v_channel text;
  v_qty integer;
  v_unit_ht numeric;
  v_line_ttc numeric;
  v_override numeric;
  v_total numeric := 0;
  v_tx uuid;
  v_ref text;
  v_year text := to_char(now(), 'YYYY');
  v_prefix text;
  v_seq integer;
  v_status public.transaction_status;
  v_actor uuid := coalesce(actor_id_param, (select auth.uid()));
  v_sold uuid[] := '{}';
  v_lines jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(items_param) <> 'array' or jsonb_array_length(items_param) = 0 then
    raise exception 'Une vente comporte au moins une ligne';
  end if;

  if emit_invoice_param and customer_id_param is null then
    raise exception 'Une facture nominative exige un client identifié';
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

      -- Prix garanti : le canal web transmet le montant réellement affiché au
      -- client et encaissé. Sans cela, `calculate_dynamic_price` recalculerait
      -- au cours du jour et la vente enregistrerait un montant différent de
      -- celui payé. La fenêtre de validité est contrôlée par l'appelant.
      v_override := case
        when price_overrides_param ? (v_product.id::text)
        then (price_overrides_param ->> (v_product.id::text))::numeric
      end;

      if v_override is not null then
        v_unit_ht := round(v_override / 1.21, 2);
        v_line_ttc := round(v_override * v_qty, 2);
      else
        select * into v_price from public.calculate_dynamic_price(v_product.id);
        if v_price.has_missing_rate then
          raise exception 'Cours du métal manquant pour % : synchronisez avant de vendre', v_product.sku;
        end if;
        v_unit_ht := v_price.ht;
        v_line_ttc := round(v_unit_ht * v_qty * 1.21, 2);
      end if;

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
      v_line_ttc := round(v_unit_ht * v_qty * 1.21, 2);
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

    v_total := v_total + v_line_ttc;
  end loop;

  -- L'envoi est une ligne de facture, pas un supplément invisible : la TVA
  -- belge s'applique au transport comme au bijou. Paramètre distinct plutôt
  -- que ligne libre dans `items_param` : la caisse ne doit pas pouvoir
  -- facturer un montant arbitraire sous une description choisie.
  if coalesce(shipping_ttc_param, 0) > 0 then
    v_lines := v_lines || jsonb_build_object(
      'product_id', null,
      'repair_ticket_id', null,
      'description', 'Envoi assuré — Belgique',
      'unit_price_ht', round(shipping_ttc_param / 1.21, 2),
      'quantity', 1
    );
    v_total := v_total + round(shipping_ttc_param, 2);
  end if;

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
    v_actor
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

    update public.stock_holds
       set released_at = now(), release_reason = 'vente'
     where product_id = any (v_sold) and released_at is null;

    insert into public.stock_movements (
      product_id, kind, channel, cart_ref, transaction_id, actor_id, note
    )
    select unnest(v_sold), 'vente', v_channel, cart_ref_param, v_tx, v_actor,
           'Encaissement ' || coalesce(v_ref, 'brouillon');
  end if;

  return query select v_tx, v_ref, v_total;
end;
$function$;

revoke all on function private.create_sale_core(
  jsonb, uuid, uuid, payment_method, numeric, boolean, boolean, text, uuid, jsonb, numeric)
  from public, anon, authenticated;

/* --------------------------------------------------------------------------
   Le gardien : signature inchangée, droits conservés
   -------------------------------------------------------------------------- */

create or replace function public.create_sale(
  items_param jsonb,
  customer_id_param uuid default null,
  terminal_id_param uuid default null,
  payment_method_param payment_method default null,
  discount_param numeric default 0,
  mark_paid_param boolean default false,
  emit_invoice_param boolean default false,
  cart_ref_param text default null
)
returns table(transaction_id uuid, transaction_ref text, total_amount numeric)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.has_permission('ventes.creer') then
    raise exception 'Vous n''avez pas le droit d''encaisser une vente';
  end if;

  if emit_invoice_param then
    if customer_id_param is null then
      raise exception 'Une facture nominative exige un client identifié';
    end if;
    if not private.has_permission('ventes.facturer') then
      raise exception 'Vous n''avez pas le droit d''émettre une facture';
    end if;
  end if;

  -- Ni `price_overrides_param` ni `shipping_ttc_param` ne sont transmis : le
  -- prix d'une vente en boutique se calcule, il ne se dicte pas.
  return query
    select * from private.create_sale_core(
      items_param, customer_id_param, terminal_id_param, payment_method_param,
      discount_param, mark_paid_param, emit_invoice_param, cart_ref_param,
      (select auth.uid()), null, 0);
end;
$function$;

/* --------------------------------------------------------------------------
   Confirmation du paiement en ligne
   -------------------------------------------------------------------------- */

-- Appelée par le seul webhook Mollie, sous clé service_role. Le webhook ne
-- transmet qu'un identifiant de paiement : c'est l'API Mollie qui est
-- ré-interrogée, jamais le corps de la requête.
--
-- Idempotente : Mollie rejoue ses webhooks. Une commande déjà transformée en
-- vente renvoie la même transaction sans rien réécrire.
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
as $function$
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
$function$;

revoke all on function public.web_confirm_paid(uuid, text, payment_method)
  from public, anon, authenticated;
grant execute on function public.web_confirm_paid(uuid, text, payment_method) to service_role;

-- Échec, expiration, remboursement : le pendant du chemin heureux. Les
-- réservations sont libérées pour que la pièce revienne en vitrine.
create or replace function public.web_fail_order(
  order_id_param uuid,
  status_param web_order_status,
  reason_param text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order record;
begin
  if status_param not in ('echouee', 'expiree', 'remboursee') then
    raise exception 'État invalide pour un échec de commande';
  end if;

  select o.* into v_order from public.web_orders o where o.id = order_id_param for update;
  if v_order.id is null then
    raise exception 'Commande introuvable';
  end if;

  -- Une commande déjà devenue vente ne redevient pas un échec : la correction
  -- passe par une note de crédit, comme toute vente encaissée.
  if v_order.transaction_id is not null and status_param <> 'remboursee' then
    raise exception 'Commande déjà encaissée : passez par une note de crédit';
  end if;

  update public.web_orders
     set status = status_param,
         failed_reason = reason_param,
         refunded_at = case when status_param = 'remboursee' then now() else refunded_at end
   where id = v_order.id;

  if v_order.transaction_id is null then
    with released as (
      update public.stock_holds h
         set released_at = now(), release_reason = 'abandon'
       where h.cart_ref = v_order.cart_ref and h.released_at is null
       returning h.product_id, h.channel, h.cart_ref
    )
    insert into public.stock_movements (product_id, kind, channel, cart_ref, note)
    select product_id, 'liberation', channel, cart_ref,
           coalesce(reason_param, 'Commande web non aboutie')
      from released;
  end if;

  perform private.log_web_activity(
    'web_commande_echouee',
    'Commande ' || coalesce(v_order.ref, v_order.cart_ref) || ' : ' || status_param::text ||
      coalesce(' — ' || reason_param, ''),
    'web_order', v_order.id, v_order.ref);
end;
$function$;

revoke all on function public.web_fail_order(uuid, web_order_status, text)
  from public, anon, authenticated;
grant execute on function public.web_fail_order(uuid, web_order_status, text) to service_role;

/* --------------------------------------------------------------------------
   Passage en caisse
   -------------------------------------------------------------------------- */

-- Le montant est arrêté ici, côté base, à partir des prix figés en base — le
-- navigateur n'a pas voix au chapitre sur ce que le client va payer.
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
as $function$
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
$function$;

revoke all on function public.web_begin_checkout(
  text, fulfilment_mode, numeric, text, text, text, text, text, text) from public, anon;
grant execute on function public.web_begin_checkout(
  text, fulfilment_mode, numeric, text, text, text, text, text, text) to authenticated;

-- Enregistre l'identifiant Mollie pour que le webhook retrouve la commande.
-- Le webhook ne s'y fie pas pour l'identité : il lit `metadata.web_order_id`
-- posé à la création du paiement, qu'un tiers ne peut pas fabriquer.
create or replace function public.web_attach_payment(
  cart_ref_param text,
  mollie_payment_id_param text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_cart text := private.assert_web_cart_ref(cart_ref_param);
begin
  update public.web_orders
     set mollie_payment_id = mollie_payment_id_param
   where cart_ref = v_cart
     and status = 'en_attente_paiement'
     and customer_id = (select private.current_customer_id())
     and mollie_payment_id is null;
end;
$function$;

revoke all on function public.web_attach_payment(text, text) from public, anon;
grant execute on function public.web_attach_payment(text, text) to authenticated;

-- Suivi de la commande après le retour de Mollie, côté client : la page de
-- confirmation doit pouvoir afficher un état sans attendre le webhook.
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
as $function$
declare
  v_cart text := private.assert_web_cart_ref(cart_ref_param);
begin
  return query
    select o.id, o.ref, o.status, o.total_ttc, o.fulfilment_mode, o.paid_at, o.failed_reason
      from public.web_orders o
     where o.cart_ref = v_cart;
end;
$function$;

revoke all on function public.web_order_status(text) from public;
grant execute on function public.web_order_status(text) to anon, authenticated;
