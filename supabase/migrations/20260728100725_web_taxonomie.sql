-- Taxonomie du catalogue — marque, catégorie, univers
--
-- L'inventaire décrit une pièce par ce qu'elle *est*. Le site a besoin de la
-- ranger : sous quelle maison, dans quel rayon, dans quel univers. Ces trois
-- axes n'existaient nulle part.
--
-- Deux états de stock supplémentaires apparaissent côté vitrine : « sur
-- demande » et « pièce unique ». Ils ne sont PAS ajoutés à l'enum
-- `product_status` : celui-ci est lu par `scan_product`, `create_sale`, la
-- caisse et toute la RLS. Y toucher pour un besoin d'affichage ferait porter
-- un risque comptable à une étiquette. Le libellé montré au client est dérivé.

create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  kind text not null,
  blurb text,
  hero_storage_path text,
  sort int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table brands is
  'Maisons représentées par la Maison Piron. Alimente la navigation, les pages marque et le filtre du catalogue.';
comment on column brands.slug is
  'Segment d''URL de /maisons/<slug>. Stable : le changer casse les liens et le référencement.';

drop trigger if exists trg_brands_updated_at on brands;
create trigger trg_brands_updated_at
  before update on brands
  for each row execute function private.touch_updated_at();

alter table brands enable row level security;

-- Des enums plutôt que du texte libre : ces deux listes structurent la
-- navigation. Une faute de frappe ne doit pas créer un rayon fantôme.
do $$ begin
  create type product_category as enum (
    'Bagues', 'Boucles d''oreilles', 'Mono boucles d''oreilles', 'Bracelets',
    'Colliers', 'Pendentifs', 'Fermoirs', 'Montres');
exception when duplicate_object then null; end $$;

do $$ begin
  create type product_univers as enum (
    'Joaillerie', 'Fiançailles', 'Mariage', 'Horlogerie', 'Accessoires',
    'Seconde main');
exception when duplicate_object then null; end $$;

alter table products
  add column if not exists brand_id uuid references brands (id) on delete set null,
  add column if not exists category product_category,
  add column if not exists univers product_univers,
  add column if not exists supply_mode text not null default 'stock'
    check (supply_mode in ('stock', 'sur_demande')),
  add column if not exists is_piece_unique boolean not null default false;

comment on column products.supply_mode is
  'Vitrine uniquement. N''influence ni le stock ni la vente : une pièce sur demande n''est simplement pas présentée comme immédiatement essayable.';
comment on column products.is_piece_unique is
  'Vitrine uniquement. Toutes les pièces sont uniques par construction ; ce drapeau signale celles qu''on met en avant comme telles.';

create index if not exists products_brand_idx on products (brand_id);
create index if not exists products_category_idx on products (category);
create index if not exists products_univers_idx on products (univers);

insert into permission_catalogue (key, category, label, description, sort) values
  ('web.marques', 'Site web', 'Gérer les maisons',
   'Créer et modifier les marques représentées, leur texte et leur visuel.', 10),
  ('web.publier', 'Site web', 'Publier une pièce',
   'Rendre une pièce visible sur le site, la retirer, gérer ses photos web.', 20)
on conflict (key) do nothing;

-- Le gemmologue choisit les pièces et connaît les maisons : c'est lui qui
-- tient la vitrine. La vendeuse encaisse et conseille, elle ne publie pas.
insert into role_permissions (role, permission_key) values
  ('gemmologue', 'web.marques'),
  ('gemmologue', 'web.publier')
on conflict do nothing;

drop policy if exists "staff_select" on brands;
drop policy if exists "staff_insert" on brands;
drop policy if exists "staff_update" on brands;
drop policy if exists "staff_delete" on brands;

create policy "staff_select" on brands for select to authenticated
  using ((select private.is_staff()));
create policy "staff_insert" on brands for insert to authenticated
  with check ((select private.has_permission('web.marques')));
create policy "staff_update" on brands for update to authenticated
  using ((select private.has_permission('web.marques')))
  with check ((select private.has_permission('web.marques')));
create policy "staff_delete" on brands for delete to authenticated
  using ((select private.has_permission('web.marques')));

insert into brands (name, slug, kind, sort) values
  ('1909 Callegari',             '1909-callegari',             'Fermoirs & chaînes',      10),
  ('BE8 Jewels',                 'be8-jewels',                 'Diamants',                20),
  ('Bloch',                      'bloch',                      'Maroquinerie',            30),
  ('Burato',                     'burato',                     'Joaillerie',              40),
  ('Concordia',                  'concordia',                  'Or tressé',               50),
  ('Dodo',                       'dodo',                       'Joaillerie du quotidien', 60),
  ('Ligne Piron',                'ligne-piron',                'Créations de la Maison',   1),
  ('Marco Valente High Jewelry', 'marco-valente-high-jewelry', 'Haute joaillerie',        70),
  ('Mattioli',                   'mattioli',                   'Joaillerie',              80),
  ('Montblanc',                  'montblanc',                  'Horlogerie & écriture',   90),
  ('Pasquale Bruni',             'pasquale-bruni',             'Joaillerie',             100),
  ('PIK',                        'pik',                        'Accessoires',            110),
  ('Pomellato',                  'pomellato',                  'Joaillerie',             120),
  ('QLOCKTWO',                   'qlocktwo',                   'Horlogerie d''intérieur',130),
  ('Sophie Bille Brahe',         'sophie-bille-brahe',         'Perles',                 140),
  ('Vhernier',                   'vhernier',                   'Joaillerie',             150)
on conflict (slug) do nothing;

update brands
   set blurb = 'La ligne de la Maison : dessinée et fabriquée à l''atelier de la Rue des Dominicains, en séries de quelques pièces. Les noms viennent de Liège — Perron, Dominicains, Meuse.'
 where slug = 'ligne-piron' and blurb is null;
