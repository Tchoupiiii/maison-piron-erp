-- record_payment : correction d'une colonne ambiguë introduite par le fix précédent
--
-- La réécriture atomique de 20260802090000 utilisait `status`/`amount_paid`
-- sans qualification dans l'UPDATE : ces noms sont aussi ceux des paramètres
-- de sortie de `returns table(amount_paid, outstanding, status)`, donc
-- ambigus avec les colonnes de `transactions` du point de vue de PL/pgSQL.
-- Détecté par le test d'impersonation avant tout déploiement client
-- (ERROR 42702: column reference "status" is ambiguous). Fix : alias `t` sur
-- la table dans l'UPDATE, toutes les lectures qualifiées par `t.`.

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

  update public.transactions as t
     set amount_paid = round(t.amount_paid + amount_param, 2),
         status = case
           when round(t.amount_paid + amount_param, 2) >= t.total_amount then 'payee'
           else 'payee_partielle'
         end
   where t.id = transaction_id_param
     and t.status in ('emise', 'payee_partielle')
     and round(t.amount_paid + amount_param, 2) <= t.total_amount
   returning t.amount_paid, round(t.total_amount - t.amount_paid, 2), t.status
    into v_paid, v_outstanding, v_status;

  if not found then
    raise exception 'Le montant dépasse le solde dû';
  end if;

  return query select v_paid, v_outstanding, v_status;
end;
$$;
