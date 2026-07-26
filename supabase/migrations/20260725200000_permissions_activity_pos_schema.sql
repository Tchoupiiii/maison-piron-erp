-- Itération 2 : référentiel des titres de métaux, permissions fines,
-- journal d'activité, caisses et encaissement.

create type activity_action as enum (
  'connexion', 'deconnexion',
  'produit_cree', 'produit_modifie', 'produit_statut', 'produit_supprime',
  'prix_modifie', 'prix_recalcule',
  'ticket_cree', 'ticket_statut',
  'client_cree', 'client_modifie', 'client_supprime',
  'client_anonymise', 'client_exporte',
  'vente_creee', 'facture_emise', 'paiement_enregistre',
  'employe_cree', 'employe_modifie', 'employe_desactive', 'employe_supprime',
  'session_revoquee', 'permission_modifiee',
  'caisse_creee', 'caisse_modifiee',
  'sync_metaux'
);

create type payment_method as enum ('especes', 'bancontact', 'carte', 'virement', 'mixte');

-- ---------------------------------------------------------------------------
-- Titres légaux des métaux précieux : alimente les sélecteurs de carat.
-- La contrainte 1–1000 sur product_materials reste, donc un titre hors
-- référentiel demeure saisissable pour une pièce ancienne ou étrangère.
-- ---------------------------------------------------------------------------
create table metal_titles (
  metal_kind metal_kind not null,
  purity_per_mille smallint not null check (purity_per_mille between 1 and 1000),
  label text not null,
  karat smallint,
  sort smallint not null default 0,
  primary key (metal_kind, purity_per_mille)
);

insert into metal_titles (metal_kind, purity_per_mille, label, karat, sort) values
  ('or', 375, 'Or 9 carats · 375 ‰', 9, 10),
  ('or', 417, 'Or 10 carats · 417 ‰', 10, 20),
  ('or', 585, 'Or 14 carats · 585 ‰', 14, 30),
  ('or', 750, 'Or 18 carats · 750 ‰', 18, 40),
  ('or', 833, 'Or 20 carats · 833 ‰', 20, 50),
  ('or', 916, 'Or 22 carats · 916 ‰', 22, 60),
  ('or', 999, 'Or fin 24 carats · 999 ‰', 24, 70),
  ('argent', 800, 'Argent 800 ‰', null, 10),
  ('argent', 830, 'Argent 830 ‰', null, 20),
  ('argent', 925, 'Argent sterling · 925 ‰', null, 30),
  ('argent', 999, 'Argent fin · 999 ‰', null, 40),
  ('platine', 850, 'Platine 850 ‰', null, 10),
  ('platine', 900, 'Platine 900 ‰', null, 20),
  ('platine', 950, 'Platine 950 ‰', null, 30),
  ('platine', 999, 'Platine fin · 999 ‰', null, 40);

-- ---------------------------------------------------------------------------
-- Permissions : catalogue figé, défauts par rôle, exceptions par personne.
-- ---------------------------------------------------------------------------
create table permission_catalogue (
  key text primary key,
  category text not null,
  label text not null,
  description text not null,
  sort smallint not null default 0
);

insert into permission_catalogue (key, category, label, description, sort) values
  ('inventaire.voir',       'Inventaire', 'Consulter l''inventaire',   'Voir les pièces, leurs matériaux et leurs prix affichés', 10),
  ('inventaire.creer',      'Inventaire', 'Créer une pièce',           'Ajouter une nouvelle pièce au catalogue', 20),
  ('inventaire.modifier',   'Inventaire', 'Modifier une pièce',        'Éditer description, matériaux, pierres et médias', 30),
  ('inventaire.statut',     'Inventaire', 'Changer le statut',         'Passer une pièce en stock, réservée ou vendue', 40),
  ('inventaire.prix',       'Inventaire', 'Modifier les prix',         'Changer la façon, le coefficient de marge et recalculer une étiquette', 50),
  ('inventaire.supprimer',  'Inventaire', 'Supprimer une pièce',       'Suppression définitive, refusée si la pièce a déjà été vendue', 60),
  ('atelier.voir',          'Atelier',    'Consulter l''atelier',      'Voir les tickets de réparation et leurs échéances', 10),
  ('atelier.creer',         'Atelier',    'Créer un ticket',           'Enregistrer une prise en charge et ses photos', 20),
  ('atelier.statut',        'Atelier',    'Faire avancer un ticket',   'Changer la colonne du ticket et notifier le client', 30),
  ('atelier.supprimer',     'Atelier',    'Supprimer un ticket',       'Suppression définitive d''un ticket et de son historique', 40),
  ('clientele.voir',        'Clientèle',  'Consulter les clients',     'Voir les fiches, préférences et historiques d''achat', 10),
  ('clientele.creer',       'Clientèle',  'Créer un client',           'Enregistrer une nouvelle fiche client', 20),
  ('clientele.modifier',    'Clientèle',  'Modifier un client',        'Éditer coordonnées, préférences et consentements', 30),
  ('clientele.rgpd',        'Clientèle',  'Actions RGPD',              'Anonymiser une fiche ou exporter les données personnelles', 40),
  ('clientele.supprimer',   'Clientèle',  'Supprimer un client',       'Refusé dès qu''une vente existe : passer par l''anonymisation', 50),
  ('ventes.voir',           'Ventes',     'Consulter les ventes',      'Voir le journal des ventes et les factures', 10),
  ('ventes.creer',          'Ventes',     'Encaisser une vente',       'Créer une vente au comptoir ou au point de vente', 20),
  ('ventes.facturer',       'Ventes',     'Émettre une facture',       'Attribuer un numéro de facture et l''envoyer au client', 30),
  ('ventes.paiement',       'Ventes',     'Enregistrer un paiement',   'Saisir un règlement partiel ou total', 40),
  ('metaux.voir',           'Métaux',     'Consulter les cours',       'Voir les cours, la courbe et le journal de synchronisation', 10),
  ('metaux.sync',           'Métaux',     'Forcer une synchronisation','Déclencher manuellement la récupération des cours', 20),
  ('metaux.recalculer',     'Métaux',     'Recalculer les étiquettes', 'Répercuter un nouveau cours sur les prix du catalogue', 30),
  ('systeme.employes',      'Système',    'Gérer les employés',        'Créer, désactiver, supprimer et déconnecter des comptes', 10),
  ('systeme.permissions',   'Système',    'Gérer les permissions',     'Modifier les droits par rôle et par personne', 20),
  ('systeme.journal',       'Système',    'Consulter le journal',      'Lire le journal d''activité et les sessions actives', 30),
  ('systeme.caisses',       'Système',    'Gérer les caisses',         'Ajouter et configurer les points de vente', 40);

create table role_permissions (
  role staff_role not null,
  permission_key text not null references permission_catalogue (key) on delete cascade,
  primary key (role, permission_key)
);

-- L'admin n'a pas de ligne : has_permission() lui répond toujours vrai.
insert into role_permissions (role, permission_key)
select 'gemmologue', key from permission_catalogue
 where key in (
   'inventaire.voir', 'inventaire.creer', 'inventaire.modifier', 'inventaire.statut',
   'inventaire.prix', 'inventaire.supprimer',
   'atelier.voir', 'atelier.creer', 'atelier.statut',
   'clientele.voir', 'clientele.creer', 'clientele.modifier', 'clientele.rgpd',
   'ventes.voir', 'ventes.creer', 'ventes.facturer', 'ventes.paiement',
   'metaux.voir', 'metaux.sync', 'metaux.recalculer'
 );

insert into role_permissions (role, permission_key)
select 'vendeuse', key from permission_catalogue
 where key in (
   'inventaire.voir', 'inventaire.statut',
   'atelier.voir', 'atelier.creer', 'atelier.statut',
   'clientele.voir', 'clientele.creer', 'clientele.modifier',
   'ventes.voir', 'ventes.creer', 'ventes.paiement',
   'metaux.voir'
 );

-- Exception nominative : écrase le défaut du rôle dans les deux sens.
create table staff_permissions (
  staff_id uuid not null references staff_profiles (id) on delete cascade,
  permission_key text not null references permission_catalogue (key) on delete cascade,
  granted boolean not null,
  updated_at timestamptz not null default now(),
  primary key (staff_id, permission_key)
);

-- ---------------------------------------------------------------------------
-- Employés : désactivation plutôt que suppression, e-mail dupliqué pour
-- l'affichage (auth.users n'est pas lisible depuis PostgREST).
-- ---------------------------------------------------------------------------
alter table staff_profiles
  add column email text,
  add column is_active boolean not null default true,
  add column deactivated_at timestamptz,
  add column updated_at timestamptz not null default now();

update staff_profiles sp
   set email = u.email
  from auth.users u
 where u.id = sp.id;

create trigger trg_staff_profiles_updated_at before update on staff_profiles
  for each row execute function private.touch_updated_at();

-- Supprimer un employé ne doit pas buter sur une facture qu'il a émise :
-- on garde la trace comptable, on perd seulement le lien vers le compte.
alter table transactions
  drop constraint transactions_created_by_fkey,
  add constraint transactions_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null;

alter table repair_status_history
  drop constraint repair_status_history_changed_by_fkey,
  add constraint repair_status_history_changed_by_fkey
    foreign key (changed_by) references auth.users (id) on delete set null;

alter table rgpd_action_log
  drop constraint rgpd_action_log_performed_by_fkey,
  add constraint rgpd_action_log_performed_by_fkey
    foreign key (performed_by) references auth.users (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Journal d'activité.
-- ---------------------------------------------------------------------------
create table activity_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid references auth.users (id) on delete set null,
  actor_name text not null,
  actor_role staff_role,
  action activity_action not null,
  entity_type text,
  entity_id uuid,
  entity_label text,
  summary text not null,
  changes jsonb,
  ip_address inet,
  user_agent text
);

create index on activity_log (occurred_at desc);
create index on activity_log (actor_id, occurred_at desc);
create index on activity_log (action, occurred_at desc);
create index on activity_log (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Caisses et encaissement.
-- ---------------------------------------------------------------------------
create table pos_terminals (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  location text,
  is_active boolean not null default true,
  -- format du ticket : l'ERP produit du HTML ou du PDF, jamais de flux ESC/POS
  receipt_format text not null default 'thermique_80'
    check (receipt_format in ('thermique_80', 'thermique_58', 'a4')),
  scanner_mode text not null default 'clavier'
    check (scanner_mode in ('clavier', 'camera')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_pos_terminals_updated_at before update on pos_terminals
  for each row execute function private.touch_updated_at();

insert into pos_terminals (code, name, location) values
  ('CAISSE-1', 'Caisse boutique', 'Rue Hors-Château 42, Liège');

-- Une vente de comptoir n'a pas toujours de client identifié : le ticket de
-- caisse suffit. L'émission d'une facture nominative reste conditionnée à un
-- client, côté Server Action.
alter table transactions
  alter column customer_id drop not null,
  add column terminal_id uuid references pos_terminals (id) on delete set null,
  add column payment_method payment_method,
  add column discount_amount numeric(10, 2) not null default 0 check (discount_amount >= 0);

create index on transactions (terminal_id, created_at desc);
