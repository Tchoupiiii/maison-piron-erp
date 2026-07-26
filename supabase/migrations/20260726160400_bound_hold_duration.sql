-- Durée de réservation bornée
--
-- `minutes_param` venait du client sans plafond : un appel direct à
-- /rest/v1/rpc/scan_product pouvait poser une réservation à des années, et
-- l'index unique `stock_holds_one_live_per_product` rendait alors la pièce
-- invendable jusque-là — en boutique comme en ligne. Une journée est déjà bien
-- au-delà d'un panier de comptoir.

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
  -- entre 1 minute et 24 h, quoi qu'annonce l'appelant
  v_expires timestamptz :=
    now() + make_interval(mins => least(greatest(coalesce(minutes_param, 30), 1), 1440));
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
