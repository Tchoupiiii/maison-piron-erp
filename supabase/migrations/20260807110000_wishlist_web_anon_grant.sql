-- Correction : wishlist_add/wishlist_remove doivent être joignables par `anon`
--
-- Appelées depuis la fiche produit, une page publique. Sans le grant `anon`,
-- PostgREST refuse l'appel avant même d'atteindre le corps de la fonction
-- (« permission denied for function... ») — le message clair posé dans
-- wishlist_add/wishlist_remove pour un visiteur non connecté n'est jamais
-- atteint. Même pattern que web_hold_product (panier), qui reçoit déjà les
-- deux rôles. wishlist_list reste authenticated seule : appelée uniquement
-- depuis /compte/liste-de-souhaits, une page déjà protégée par le proxy.

grant execute on function public.wishlist_add(text) to anon;
grant execute on function public.wishlist_remove(text) to anon;
