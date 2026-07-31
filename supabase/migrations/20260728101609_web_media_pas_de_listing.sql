-- Un bucket public sert ses objets par URL sans aucune policy SELECT sur
-- storage.objects : cette policy-là n'autorisait que l'énumération. Or lister
-- le bucket révélerait aussi les visuels préparés pour des pièces pas encore
-- publiées — exactement ce que la publication explicite cherche à éviter.
-- Les <img> du site continuent de fonctionner ; seul `list()` est refusé.
--
-- Signalé par l'advisor Supabase : public_bucket_allows_listing.
drop policy if exists "web_media_read" on storage.objects;
