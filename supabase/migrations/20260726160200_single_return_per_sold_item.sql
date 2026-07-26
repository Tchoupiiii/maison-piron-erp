-- Un retour, une fois, et seulement sur une vente qui existe comptablement
--
-- Le garde-fou anti-double-retour comparait du texte :
--
--   where m.note like '%' || v_line.origin_ref || '%'
--
-- Sur une vente `brouillon`, `ref` est NULL : la concaténation vaut NULL, le
-- `like` vaut NULL, `exists` est faux. La garde ne se déclenchait donc jamais —
-- et `create_sale` sans encaissement ni facture produit exactement ce cas, tout
-- en marquant déjà les pièces `vendu`. Le même avoir pouvait être rejoué autant
-- de fois que voulu, chaque appel créant un `AV-` à montant négatif.
--
-- Accessoirement, `like '%TIC-2026-0001%'` attrape aussi `TIC-2026-00011`.
--
-- On remplace la comparaison de texte par une contrainte que PostgreSQL arbitre
-- lui-même, dans l'esprit de `stock_holds_one_live_per_product`.

alter table stock_movements
  add column if not exists source_item_id uuid references transaction_items (id) on delete set null;

comment on column stock_movements.source_item_id is
  'Ligne de vente à l''origine du mouvement. Sur un retour, la contrainte d''unicité en fait la preuve qu''une pièce n''est rendue qu''une fois.';

-- Rattrape les retours déjà enregistrés avant d'imposer l'unicité : sans cela,
-- l'index échouerait sur une base contenant deux avoirs pour la même ligne.
with deja as (
  select m.id,
         row_number() over (partition by m.product_id order by m.occurred_at) as rang
    from public.stock_movements m
   where m.kind = 'retour'
)
update public.stock_movements m
   set source_item_id = null
  from deja
 where deja.id = m.id and deja.rang > 1;

create unique index if not exists stock_movements_one_return_per_item
  on stock_movements (source_item_id) where source_item_id is not null;

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

  -- `for update` sur la ligne d'origine : deux retours simultanés de la même
  -- pièce se sérialisent ici, le second bute ensuite sur l'index unique.
  select ti.id, ti.product_id, ti.description, ti.unit_price_ht, ti.quantity,
         ti.line_total_ttc, t.customer_id, t.terminal_id, t.ref as origin_ref,
         t.status as origin_status
    into v_line
    from public.transaction_items ti
    join public.transactions t on t.id = ti.transaction_id
   where ti.id = transaction_item_id_param
     for update of ti;

  if v_line.id is null then
    raise exception 'Ligne de vente introuvable';
  end if;
  if v_line.product_id is null then
    raise exception 'Seule une pièce peut être retournée, pas une réparation';
  end if;
  if v_line.origin_status = 'annulee' then
    raise exception 'Cette vente est déjà annulée';
  end if;

  -- Un brouillon n'est pas une vente : rien n'a été encaissé, aucun document
  -- n'a été émis. On ne rend pas d'argent sur un panier resté ouvert — il se
  -- corrige, il ne s'avoire pas.
  if v_line.origin_status = 'brouillon' then
    raise exception
      'Cette vente est encore un brouillon : il n''y a rien à rembourser. Encaissez-la ou modifiez-la.';
  end if;

  -- Le double retour est refusé par l'index unique sur `source_item_id`. Ce
  -- test n'est là que pour le message : la base reste l'arbitre.
  if exists (
    select 1 from public.stock_movements m
     where m.source_item_id = transaction_item_id_param and m.kind = 'retour'
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
    product_id, kind, transaction_id, source_item_id, actor_id, note
  ) values (
    v_line.product_id, 'retour', v_tx, v_line.id, (select auth.uid()),
    coalesce(reason_param, 'Retour client') || ' · vente ' || v_line.origin_ref
  );

  return query select v_tx, v_ref, v_amount;
end;
$$;

revoke all on function public.return_sold_item(uuid, text) from public, anon;
grant execute on function public.return_sold_item(uuid, text) to authenticated;
