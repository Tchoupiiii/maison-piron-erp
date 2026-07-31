-- Identité légale de la Maison, lisible publiquement
--
-- Le site doit afficher raison sociale, adresse et numéro de TVA : la vente à
-- distance en Belgique l'impose (identification du vendeur), et ce sont les
-- mêmes mentions que sur les factures. `maison_settings` n'était lisible que
-- par le personnel — le site aurait dû recopier ces valeurs en dur, avec la
-- certitude qu'elles divergeraient un jour.
--
-- Rien de confidentiel n'est exposé : ces informations figurent déjà sur chaque
-- facture et à la Banque-Carrefour des Entreprises.

create or replace view public.web_maison with (security_invoker = false) as
  select
    m.display_name,
    m.legal_name,
    m.street,
    m.postal_code,
    m.city,
    m.country,
    m.vat_number
  from public.maison_settings m
  where m.id;

comment on view public.web_maison is
  'Mentions légales du vendeur, pour le site. Vue security definer : `maison_settings` n''est lisible que par le personnel, et cette identité doit l''être de tous.';

revoke all on public.web_maison from public;
grant select on public.web_maison to anon, authenticated;
