-- release_hold : vérifier que l'appelant possède le panier
--
-- La fonction ne contrôlait que le droit ventes.creer, jamais qui a posé la
-- réservation. stock_holds.held_by existe et est renseigné par scan_product,
-- mais release_hold ne le lisait jamais : n'importe quelle caissière avec
-- ventes.creer pouvait vider le panier d'une autre caisse en connaissant (ou
-- devinant) son cart_ref — confirmé exploitable via pos/src/actions/pos.ts
-- releaseHold, gardé par ventes.creer seul, cart_ref fourni par le client.
--
-- Un usage légitime existe pour lever cette restriction : Réglages > vider un
-- panier abandonné (app/src/actions/holds.ts releaseHoldAdmin), gardé par
-- systeme.caisses. Ce chemin doit continuer à libérer n'importe quel panier.

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
       and (
         private.has_permission('systeme.caisses')
         or h.held_by = (select auth.uid())
       )
     returning h.product_id, h.channel, h.cart_ref
  )
  insert into public.stock_movements (product_id, kind, channel, cart_ref, actor_id, note)
  select product_id, 'liberation', channel, cart_ref, (select auth.uid()), reason_param
    from released;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
