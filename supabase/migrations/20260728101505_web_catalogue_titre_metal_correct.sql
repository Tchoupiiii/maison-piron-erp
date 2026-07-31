-- Correction du libellé de matière.
--
-- La première version divisait le millième par 10 : 750 ‰ donnait « 75k » au
-- lieu de 18 carats. Et le carat ne s'applique qu'à l'or — « Argent 800k »
-- n'existe pas ; l'argent et le platine se disent en millièmes.
--
-- La table `metal_titles` porte déjà les quinze titres légaux avec leur carat.
-- On s'appuie dessus plutôt que de recalculer : c'est elle qui fait foi, et
-- une pièce à un titre non légal doit rester affichable en millièmes.
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
         (select string_agg(distinct lbl, ' · ' order by lbl)
            from (
              select initcap(m.metal_kind::text)
                     || coalesce(' ' || m.color::text, '')
                     || case
                          when t.karat is not null then ' ' || t.karat || ' carats'
                          else ' ' || m.purity_per_mille || ' ‰'
                        end as lbl
                from public.product_materials m
                left join public.metal_titles t
                  on t.metal_kind = m.metal_kind
                 and t.purity_per_mille = m.purity_per_mille
               where m.product_id = p.id
            ) s) as materials_label,
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
  'Surface de lecture publique du catalogue. Security definer : contourne délibérément la RLS de products en n''exposant que des champs sans valeur pour un concurrent — jamais les poids ni les coûts. is_available reprend la définition de product_availability : une pièce tenue par un panier n''est plus vendable même si son statut vaut encore en_stock.';

revoke all on public.web_catalogue from anon, authenticated;
grant select on public.web_catalogue to anon, authenticated;
