-- Rétention RGPD des demandes du site (web_enquiries)
--
-- anonymizeCustomer couvre les clients, pas les prospects : une demande de
-- contact/rendez-vous jamais convertie reste indéfiniment nominative sinon.
-- Politique : 12 mois après création si jamais traitée, 24 mois après
-- traitement sinon (un service a réellement eu lieu, on garde plus
-- longtemps mais toujours moins que les 7 ans comptables des ventes réelles).
-- On anonymise, on ne supprime pas la ligne : kind/status/dates/product_id
-- restent utiles aux statistiques de l'écran Demandes.

-- Nécessaire pour pouvoir mettre ces colonnes à null à l'anonymisation.
alter table web_enquiries alter column email drop not null;
alter table web_enquiries alter column message drop not null;

-- Worker sans contrôle, comme private.calculate_dynamic_price_internal /
-- private.create_sale_core : pensée pour être appelée sans session staff
-- (job planifié), où has_permission() échouerait systématiquement faute
-- d'auth.uid(). Aucun grant : n'est appelée que par la fonction publique
-- ci-dessous, ou directement par un futur job interne à la base.
create or replace function private.anonymize_stale_web_enquiries_internal()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.web_enquiries
     set full_name = 'Demande anonymisée',
         email = null,
         phone = null,
         subject = null,
         message = null,
         handled_note = null
   where full_name <> 'Demande anonymisée'
     and (
       (status <> 'traitee' and created_at < now() - interval '12 months')
       or (status = 'traitee' and coalesce(handled_at, created_at) < now() - interval '24 months')
     );

  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform private.log_web_activity(
      'web_enquiry_anonymisee',
      v_count || ' demande(s) du site anonymisée(s) (rétention RGPD)',
      'web_enquiry');
  end if;

  return v_count;
end;
$$;

-- Garde-puis-délègue : même pattern que public.calculate_dynamic_price.
create or replace function public.anonymize_stale_web_enquiries()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('clientele.rgpd') then
    raise exception 'Vous n''avez pas le droit d''anonymiser les demandes du site';
  end if;

  return private.anonymize_stale_web_enquiries_internal();
end;
$$;

revoke all on function public.anonymize_stale_web_enquiries() from public, anon;
grant execute on function public.anonymize_stale_web_enquiries() to authenticated;
