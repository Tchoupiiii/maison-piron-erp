-- L'estampille de publication était placée après le retour anticipé
-- « pas d'utilisateur applicatif », donc jamais posée lors d'une publication
-- faite en service_role ou par script. Horodater n'est pas une question de
-- permission : ça se fait dans tous les cas, la vérification vient après.
create or replace function private.guard_product_web_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.web_published and not coalesce(old.web_published, false) then
    new.web_published_at := now();
  elsif not new.web_published then
    new.web_published_at := null;
  end if;

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

  return new;
end;
$$;

-- Rattrape les pièces publiées avant la correction.
update products set web_published_at = coalesce(web_published_at, now())
 where web_published and web_published_at is null;
