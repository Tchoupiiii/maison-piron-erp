-- Catalogue public — la seule porte ouverte à `anon`
--
-- Toutes les policies du schéma public ciblent {authenticated} et passent par
-- private.has_permission() / is_staff() / current_staff_role(), qui résolvent
-- via staff_profiles WHERE id = auth.uid() AND is_active. Aucune ne se contente
-- de auth.uid() is not null. Un visiteur anonyme voit donc zéro ligne, y
-- compris à travers product_availability (security_invoker = true).
--
-- Ouvrir products à anon par une policy exposerait la table entière et
-- obligerait à se battre colonne par colonne contre la fuite des coûts. On fait
-- l'inverse : des vues security definer qui décident exactement ce qui sort.
--
-- Ce que ces vues ne doivent JAMAIS exposer, sous aucune évolution :
--   labor_cost_eur, margin_multiplier, cached_metal_cost, cached_stone_cost,
--   cached_ht, price_per_carat, weight_grams, rfid_tag, showcase_slot.
-- Le TTC seul est public ; le reste permettrait de reconstituer la marge de la
-- maison, pièce par pièce.
--
-- L'advisor Supabase signalera ces vues en WARN « security definer view ».
-- C'est le mécanisme, pas un oubli.

create or replace view public.web_brands
with (security_invoker = false) as
  select b.slug,
         b.name,
         b.kind,
         b.blurb,
         b.hero_storage_path,
         b.sort,
         (select count(*)
            from public.products p
           where p.brand_id = b.id and p.web_published) as published_count
    from public.brands b
   where b.is_active;

create or replace view public.web_catalogue
with (security_invoker = false) as
  select p.id              as product_id,
         p.web_slug        as slug,
         p.name,
         p.web_description as description,
         b.name            as brand_name,
         b.slug            as brand_slug,
         b.kind            as brand_kind,
         p.category::text  as category,
         p.univers::text   as univers,
         p.cached_ttc      as price_ttc,
         p.price_computed_at,
         p.supply_mode,
         p.is_piece_unique,
         p.status::text    as status,
         p.web_sort,
         p.web_published_at,
         (p.status = 'en_stock' and h.id is null) as is_available,
         (select string_agg(distinct
                   initcap(m.metal_kind::text) || ' ' || m.color::text || ' '
                   || round(m.purity_per_mille / 10.0)::text || 'k', ' · ')
            from public.product_materials m
           where m.product_id = p.id) as materials_label,
         (select string_agg(distinct initcap(g.gemstone_type::text), ' · ')
            from public.product_gemstones g
           where g.product_id = p.id) as gemstones_label
    from public.products p
    left join public.brands b on b.id = p.brand_id
    left join public.stock_holds h
      on h.product_id = p.id
     and h.released_at is null
     and h.expires_at > now()
   where p.web_published
     and p.web_slug is not null;

comment on view public.web_catalogue is
  'Surface de lecture publique du catalogue. Security definer : contourne délibérément la RLS de products en n''exposant que des champs sans valeur pour un concurrent. is_available reprend la définition de product_availability — une pièce tenue par un panier n''est plus vendable même si son statut vaut encore en_stock.';

create or replace view public.web_product_media
with (security_invoker = false) as
  select p.web_slug         as slug,
         m.storage_path,
         m.media_type::text as media_type,
         m.position
    from public.product_media m
    join public.products p on p.id = m.product_id
   where m.bucket_id = 'web_media'
     and p.web_published
     and p.web_slug is not null
     -- Ceinture et bretelles : un certificat de labo n'a rien à faire dans le
     -- bucket public, mais s'il y atterrissait un jour il ne sortirait pas ici.
     and m.media_type <> 'certificat'
     and m.gemstone_id is null;

create or replace view public.web_product_stones
with (security_invoker = false) as
  select p.web_slug            as slug,
         g.name,
         g.gemstone_type::text as gemstone_type,
         g.carat_weight,
         g.stone_count,
         g.clarity,
         g.color,
         g.cut,
         g.certificate_lab::text as certificate_lab
    from public.product_gemstones g
    join public.products p on p.id = g.product_id
   where p.web_published
     and p.web_slug is not null;

comment on view public.web_product_stones is
  'Caractéristiques gemmologiques présentables. price_per_carat est exclu : c''est un prix d''achat.';

-- Supabase accorde par défaut tous les privilèges à anon et authenticated sur
-- les nouveaux objets du schéma public. On repart de zéro : un privilège qui
-- n'existe pas ne peut pas devenir un problème.
revoke all on public.web_brands         from anon, authenticated;
revoke all on public.web_catalogue      from anon, authenticated;
revoke all on public.web_product_media  from anon, authenticated;
revoke all on public.web_product_stones from anon, authenticated;

grant select on public.web_brands         to anon, authenticated;
grant select on public.web_catalogue      to anon, authenticated;
grant select on public.web_product_media  to anon, authenticated;
grant select on public.web_product_stones to anon, authenticated;
