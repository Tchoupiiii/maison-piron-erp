-- Numérotation FA-/TIC- : verrou 64 bits au lieu de 32
--
-- emit_invoice et create_sale_core utilisent tous les deux
-- pg_advisory_xact_lock(hashtext(v_prefix)) pour sérialiser l'attribution du
-- prochain numéro sous un préfixe donné. hashtext() est un hash 32 bits :
-- risque théorique que deux préfixes différents (ex. FA-2026- et TIC-2027-)
-- collisionnent et se sérialisent à tort. hashtextextended(text, seed) donne
-- un hash 64 bits, rendant la collision négligeable — sans toucher à la
-- logique de génération du numéro elle-même (max(...)+1 sous verrou,
-- inchangée).

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

  perform pg_advisory_xact_lock(hashtextextended(v_prefix, 0));
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
    perform pg_advisory_xact_lock(hashtextextended(v_prefix, 0));
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
