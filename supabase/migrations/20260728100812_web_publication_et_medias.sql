-- Publication sur le site et photos web
--
-- Une pièce présente à l'inventaire n'a aucune raison d'apparaître en ligne :
-- un dépôt en attente d'estimation, une commande client, une pièce sans photo
-- correcte n'ont rien à faire en vitrine. La publication est un geste explicite
-- du personnel, pas une conséquence de la mise en stock.
--
-- Les photos web vont dans un bucket public distinct. `produit_media` reste
-- privé : il contient les scans de certificats GIA/IGI/HRD, qui portent des
-- numéros opposables. Les mélanger reviendrait à publier ces documents à la
-- première erreur de politique.

alter table products
  add column if not exists web_published boolean not null default false,
  add column if not exists web_published_at timestamptz,
  add column if not exists web_slug text,
  add column if not exists web_description text,
  add column if not exists web_sort int;

create unique index if not exists products_web_slug_key
  on products (web_slug) where web_slug is not null;
create index if not exists products_web_published_idx
  on products (web_published) where web_published;

comment on column products.web_slug is
  'Segment d''URL de /piece/<slug>. Stable une fois publié : le changer casse les liens partagés et le référencement.';
comment on column products.web_description is
  'Le texte de l''inventaire est écrit pour l''atelier, celui-ci pour le client. Deux publics, deux colonnes.';

alter table product_media
  add column if not exists bucket_id text not null default 'produit_media';

do $$ begin
  alter table product_media add constraint product_media_bucket_id_check
    check (bucket_id in ('produit_media', 'web_media'));
exception when duplicate_object then null; end $$;

comment on column product_media.bucket_id is
  'produit_media (privé) : photos de travail et scans de certificats. web_media (public) : visuels de la vitrine, servis directement au navigateur.';

create index if not exists product_media_web_idx
  on product_media (product_id, position) where bucket_id = 'web_media';

insert into storage.buckets (id, name, public)
values ('web_media', 'web_media', true)
on conflict (id) do nothing;

-- Lecture publique : c'est tout l'intérêt du bucket, les visuels sont servis
-- au navigateur sans URL signée. L'écriture reste réservée à qui peut publier.
drop policy if exists "web_media_read" on storage.objects;
create policy "web_media_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'web_media');

drop policy if exists "web_media_write" on storage.objects;
create policy "web_media_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'web_media' and (select private.has_permission('web.publier')));

drop policy if exists "web_media_update" on storage.objects;
create policy "web_media_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'web_media' and (select private.has_permission('web.publier')))
  with check (bucket_id = 'web_media' and (select private.has_permission('web.publier')));

drop policy if exists "web_media_delete" on storage.objects;
create policy "web_media_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'web_media' and (select private.has_permission('web.publier')));

-- `guard_product_columns` exige `inventaire.modifier` pour toute colonne hors
-- de sa liste d'exceptions. On y ajoute les colonnes de vitrine, sans quoi
-- publier demanderait deux permissions au lieu d'une — exactement le
-- traitement déjà réservé à `status`, confié à `inventaire.statut`.
create or replace function private.guard_product_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ignored text[] := array['status', 'sold_at', 'updated_at',
    'margin_multiplier', 'labor_cost_eur', 'labor_description',
    'cached_metal_cost', 'cached_stone_cost', 'cached_ht', 'cached_ttc',
    'price_computed_at',
    'web_published', 'web_published_at', 'web_slug', 'web_description',
    'web_sort', 'brand_id', 'category', 'univers', 'supply_mode',
    'is_piece_unique'];
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if (new.status, new.sold_at) is distinct from (old.status, old.sold_at)
     and not private.has_permission('inventaire.statut') then
    raise exception 'Vous n''avez pas le droit de changer le statut d''une pièce';
  end if;

  if (new.margin_multiplier, new.labor_cost_eur, new.labor_description,
      new.cached_metal_cost, new.cached_stone_cost, new.cached_ht,
      new.cached_ttc, new.price_computed_at)
     is distinct from
     (old.margin_multiplier, old.labor_cost_eur, old.labor_description,
      old.cached_metal_cost, old.cached_stone_cost, old.cached_ht,
      old.cached_ttc, old.price_computed_at)
     and not private.has_permission('inventaire.prix') then
    raise exception 'Vous n''avez pas le droit de modifier les prix';
  end if;

  if (to_jsonb(new) - ignored) is distinct from (to_jsonb(old) - ignored)
     and not private.has_permission('inventaire.modifier') then
    raise exception 'Vous n''avez pas le droit de modifier une pièce';
  end if;

  return new;
end;
$$;

-- Sans ce verrou, toute personne pouvant corriger un poids de métal pourrait
-- aussi mettre une pièce en ligne. La RLS travaille à la ligne, pas à la
-- colonne : d'où un trigger, comme les autres guards du projet.
create or replace function private.guard_product_web_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if (new.web_published   is distinct from old.web_published)
  or (new.web_slug        is distinct from old.web_slug)
  or (new.web_description is distinct from old.web_description)
  or (new.web_sort        is distinct from old.web_sort)
  or (new.brand_id        is distinct from old.brand_id)
  or (new.category        is distinct from old.category)
  or (new.univers         is distinct from old.univers)
  or (new.supply_mode     is distinct from old.supply_mode)
  or (new.is_piece_unique is distinct from old.is_piece_unique)
  then
    if not private.has_permission('web.publier') then
      raise exception 'Vous n''avez pas le droit de publier une pièce sur le site';
    end if;
  end if;

  if new.web_published and not coalesce(old.web_published, false) then
    new.web_published_at := now();
  end if;

  return new;
end;
$$;

-- Nommé pour s'exécuter après trg_products_guard_columns (les triggers BEFORE
-- d'une même table s'exécutent dans l'ordre alphabétique).
drop trigger if exists trg_products_guard_web_columns on products;
create trigger trg_products_guard_web_columns
  before update on products
  for each row execute function private.guard_product_web_columns();
