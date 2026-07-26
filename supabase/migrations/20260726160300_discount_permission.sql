-- La remise devient un droit, pas un champ libre
--
-- `discount_param` n'était borné que par « le total ne peut pas devenir
-- négatif ». Toute personne pouvant encaisser — la vendeuse par défaut —
-- pouvait donc ramener une pièce à 15 000 € à zéro euro. C'est le seul chemin
-- monétaire de l'ERP qui n'avait pas de permission propre, dans un métier où la
-- remise au comptoir est le vecteur classique de la fraude interne.
--
-- Le contrôle vit dans un trigger plutôt que dans `create_sale` : la remise est
-- écrite dans `transactions.discount_amount`, donc la table est le bon endroit
-- pour la défendre — quel que soit le chemin qui l'écrit, aujourd'hui ou demain.

insert into permission_catalogue (key, category, label, description, sort)
values ('ventes.remise', 'Ventes', 'Accorder une remise',
        'Réduire le montant d''une vente au moment de l''encaissement', 35)
on conflict (key) do nothing;

-- Accordée au gemmologue, comme le retour : les deux gestes rendent de
-- l'argent. La vendeuse peut l'obtenir par exception nominative si la maison le
-- décide, depuis Réglages.
insert into role_permissions (role, permission_key)
values ('gemmologue', 'ventes.remise')
on conflict do nothing;

create or replace function private.guard_transaction_discount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_accorde boolean;
begin
  -- service_role, cron et console SQL n'ont pas de session : la RLS ne
  -- s'applique pas non plus dans ce cas.
  if (select auth.uid()) is null then
    return new;
  end if;

  -- `old` n'est pas assigné sur un INSERT — y toucher lèverait une erreur.
  -- Une remise posée à la création est de toute façon nouvelle par définition.
  if tg_op = 'INSERT' then
    v_accorde := new.discount_amount > 0;
  else
    v_accorde := new.discount_amount > 0
             and new.discount_amount is distinct from old.discount_amount;
  end if;

  if v_accorde and not private.has_permission('ventes.remise') then
    raise exception 'Vous n''avez pas le droit d''accorder une remise';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_transactions_guard_discount on transactions;
create trigger trg_transactions_guard_discount before insert or update on transactions
  for each row execute function private.guard_transaction_discount();
