-- Droits d'exécution oubliés sur les fonctions du stock
--
-- Toutes les migrations précédentes terminaient par un `revoke all ... from
-- public, anon` sur chaque fonction créée. La migration `stock_holds_rfid_returns`
-- ne l'a pas fait : PostgreSQL accorde EXECUTE à `public` par défaut, donc ses
-- cinq fonctions `security definer` étaient appelables par `anon`, sans compte,
-- via /rest/v1/rpc.
--
-- Quatre se défendaient seules — elles commencent par `has_permission`, faux
-- sans session. `release_expired_holds` n'avait aucun contrôle : elle écrivait
-- en base pour n'importe qui connaissant l'URL publique du projet.

-- Les quatre fonctions appelées par l'application avec la session de l'employé.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.create_sale(jsonb, uuid, uuid, public.payment_method, numeric, boolean, boolean, text)',
    'public.scan_product(text, text, text, uuid, integer)',
    'public.release_hold(text, uuid, text)',
    'public.return_sold_item(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

-- Celle-ci n'est appelée que par `scan_product` et `create_sale`, jamais par
-- l'application : personne n'a besoin d'EXECUTE. Les deux appelantes sont
-- `security definer` et propriété de postgres — elles l'exécutent sous cette
-- identité, donc le retrait total ne les gêne pas. Aucun droit à accorder,
-- aucun droit à oublier plus tard.
revoke all on function public.release_expired_holds() from public, anon, authenticated;
