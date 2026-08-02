-- record_payment : la garde devient atomique
--
-- La fonction lisait amount_paid/total_amount, calculait le nouveau total en
-- mémoire, puis écrivait dans un UPDATE séparé. Deux appels concurrents sur la
-- même vente (double-clic, deux terminaux) pouvaient tous les deux lire le
-- même état avant que l'un des deux n'écrive, et dépasser total_amount.
--
-- Le fix : la garde (statut valide + montant qui ne dépasse pas le solde) fait
-- désormais partie du WHERE de l'UPDATE lui-même, donc plus de fenêtre entre
-- lecture et écriture. Le reste des contrôles (permission, montant positif,
-- vente introuvable) reste en tête de fonction, avant l'update.

create or replace function public.record_payment(
  transaction_id_param uuid,
  amount_param numeric
)
returns table(amount_paid numeric, outstanding numeric, status transaction_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx record;
  v_paid numeric;
  v_outstanding numeric;
  v_status public.transaction_status;
begin
  if not private.has_permission('ventes.paiement') then
    raise exception 'Vous n''avez pas le droit d''enregistrer un paiement';
  end if;

  if amount_param is null or amount_param <= 0 then
    raise exception 'Montant invalide';
  end if;

  select t.id, t.status, t.total_amount, t.amount_paid into v_tx
    from public.transactions t where t.id = transaction_id_param;

  if v_tx.id is null then
    raise exception 'Vente introuvable';
  end if;
  if v_tx.status = 'annulee' then
    raise exception 'Vente annulée';
  end if;
  if v_tx.status = 'brouillon' then
    raise exception 'Émettez la facture avant d''enregistrer un paiement';
  end if;

  -- Garde atomique : le calcul et la condition vivent dans le même UPDATE, la
  -- ligne ne peut donc pas être modifiée entre la lecture ci-dessus et cette
  -- écriture par un second appel concurrent.
  update public.transactions
     set amount_paid = round(amount_paid + amount_param, 2),
         status = case
           when round(amount_paid + amount_param, 2) >= total_amount then 'payee'
           else 'payee_partielle'
         end
   where id = transaction_id_param
     and status in ('emise', 'payee_partielle')
     and round(amount_paid + amount_param, 2) <= total_amount
   returning amount_paid, round(total_amount - amount_paid, 2), status
    into v_paid, v_outstanding, v_status;

  if not found then
    -- Rien n'a été écrit : soit un appel concurrent a changé le statut entre
    -- temps, soit le montant dépasse le solde dû. Cette relecture ne sert
    -- qu'à produire un message clair, la garde réelle est déjà passée.
    raise exception 'Le montant dépasse le solde dû';
  end if;

  return query select v_paid, v_outstanding, v_status;
end;
$$;
