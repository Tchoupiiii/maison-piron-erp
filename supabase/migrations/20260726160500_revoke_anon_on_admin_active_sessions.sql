-- `admin_active_sessions` avait reperdu son revoke en étant recréée : elle
-- redevenait appelable par `anon`. Son `require_admin()` interne la protégeait,
-- mais la porte n'avait aucune raison d'être ouverte.
--
-- Le motif s'est produit deux fois sur ce projet : recréer une fonction
-- `security definer` sans rejouer son `revoke` la rouvre à `anon`. À vérifier
-- avec l'advisor Supabase après chaque migration qui touche une fonction.
revoke all on function public.admin_active_sessions() from public, anon;
grant execute on function public.admin_active_sessions() to authenticated;
