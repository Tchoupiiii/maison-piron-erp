-- calculate_dynamic_price : structure de coûts réservée à inventaire.prix
--
-- La fonction n'avait aucun contrôle de permission et était exécutable par
-- anon ET authenticated : n'importe quel membre du staff qui peut simplement
-- voir le catalogue (inventaire.voir, quasi tout le monde pour vendre)
-- obtenait margin_multiplier, metal_cost, stone_cost, labor_cost — la
-- structure de marge de la maison.
--
-- Piège : create_sale_core et scan_product appellent cette même fonction en
-- interne pour calculer le prix de vente. Poser inventaire.prix directement
-- dedans casserait la vente pour toute vendeuse qui n'a pas ce droit. Fix en
-- reprenant le pattern déjà utilisé par create_sale/create_sale_core : un
-- worker privé sans contrôle (usage interne uniquement, private n'est pas
-- exposé par PostgREST) et une garde publique qui contrôle puis délègue.

create or replace function private.calculate_dynamic_price_internal(
  product_id_param uuid,
  rate_date_param date default null
)
returns table (
  metal_cost numeric,
  stone_cost numeric,
  labor_cost numeric,
  margin_multiplier numeric,
  ht numeric,
  ttc numeric,
  rate_date_used date,
  has_missing_rate boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_margin numeric;
  v_labor numeric;
  v_rate_date date;
  v_metal numeric;
  v_stone numeric;
  v_missing boolean;
begin
  select p.margin_multiplier, p.labor_cost_eur
    into v_margin, v_labor
    from public.products p
   where p.id = product_id_param;

  if v_margin is null then
    raise exception 'Produit introuvable : %', product_id_param;
  end if;

  v_rate_date := coalesce(
    rate_date_param,
    (select max(mr.rate_date) from public.market_rates mr)
  );

  select
    coalesce(sum(
      pm.weight_grams * mr.price_eur_per_gram_fine * pm.purity_per_mille / 1000.0
    ), 0),
    bool_or(mr.id is null)
    into v_metal, v_missing
    from public.product_materials pm
    left join public.market_rates mr
      on mr.metal_kind = pm.metal_kind
     and mr.rate_date = v_rate_date
   where pm.product_id = product_id_param;

  select coalesce(sum(pg.carat_weight * pg.stone_count * pg.price_per_carat), 0)
    into v_stone
    from public.product_gemstones pg
   where pg.product_id = product_id_param;

  metal_cost := round(v_metal, 2);
  stone_cost := round(v_stone, 2);
  labor_cost := v_labor;
  margin_multiplier := v_margin;
  ht := round((metal_cost + stone_cost + labor_cost) * v_margin, 2);
  ttc := round(ht * 1.21, 2);
  rate_date_used := v_rate_date;
  has_missing_rate := coalesce(v_missing, false);
  return next;
end;
$$;

create or replace function public.calculate_dynamic_price(
  product_id_param uuid,
  rate_date_param date default null
)
returns table (
  metal_cost numeric,
  stone_cost numeric,
  labor_cost numeric,
  margin_multiplier numeric,
  ht numeric,
  ttc numeric,
  rate_date_used date,
  has_missing_rate boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not private.has_permission('inventaire.prix') then
    raise exception 'Vous n''avez pas le droit de consulter la structure de prix';
  end if;

  return query
    select * from private.calculate_dynamic_price_internal(product_id_param, rate_date_param);
end;
$$;

-- create or replace préserve les grants existants (dont anon, à tort) : il
-- faut le revoke explicitement.
revoke all on function public.calculate_dynamic_price(uuid, date) from public, anon;
grant execute on function public.calculate_dynamic_price(uuid, date) to authenticated;

-- Les appels internes utilisés pendant une vente ne doivent pas exiger
-- inventaire.prix : ils passent désormais par le worker privé.
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

      v_override := case
        when price_overrides_param ? (v_product.id::text)
        then (price_overrides_param ->> (v_product.id::text))::numeric
      end;

      if v_override is not null then
        v_unit_ht := round(v_override / 1.21, 2);
        v_line_ttc := round(v_override * v_qty, 2);
      else
        select * into v_price from private.calculate_dynamic_price_internal(v_product.id);
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

  if coalesce(discount_param, 0) > 0 and coalesce(discount_param, 0) > v_total * 0.50 then
    raise exception 'La remise dépasse le maximum autorisé (50%%)';
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
$$;

create or replace function public.scan_product(
  code_param text,
  cart_ref_param text,
  channel_param text default 'boutique',
  terminal_id_param uuid default null,
  minutes_param integer default 15
)
returns table(product_id uuid, sku text, name text, price_ttc numeric, hold_expires_at timestamptz)
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

  select * into v_price from private.calculate_dynamic_price_internal(v_id);
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
