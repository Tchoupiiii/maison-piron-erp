-- Connexion par identifiant, sans adresse e-mail.
--
-- Supabase Auth n'authentifie par mot de passe que sur une adresse ou un
-- téléphone. Le téléphone impose des SMS payants, exclus par le cahier des
-- charges. On garde donc une adresse *technique* interne, jamais affichée et
-- non délivrable (domaine réservé .invalid, RFC 2606), et l'employé ne connaît
-- que son identifiant.

alter table staff_profiles
  add column if not exists username text;

-- Identifiant sobre : minuscules, chiffres, point, tiret, souligné.
alter table staff_profiles
  drop constraint if exists staff_profiles_username_format;
alter table staff_profiles
  add constraint staff_profiles_username_format
  check (username is null or username ~ '^[a-z0-9._-]{3,32}$');

create unique index if not exists staff_profiles_username_key
  on staff_profiles (username)
  where username is not null;

comment on column staff_profiles.username is
  'Identifiant de connexion. Null = le compte se connecte avec son adresse e-mail.';
comment on column staff_profiles.email is
  'Adresse de contact. Null pour un compte qui se connecte par identifiant.';

/**
 * Résout un identifiant en adresse technique pour signInWithPassword.
 *
 * Appelable par `anon` : sans cela, impossible de se connecter. Ne renvoie que
 * l'adresse *interne* des comptes qui ont un identifiant — l'adresse réelle
 * d'un compte qui se connecte par e-mail n'est jamais exposée. Une saisie
 * inconnue renvoie null : la connexion échoue ensuite comme un mot de passe
 * faux, sans distinguer les deux cas.
 */
create or replace function public.auth_email_for_username(username_param text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::text
    from public.staff_profiles sp
    join auth.users u on u.id = sp.id
   where sp.username = lower(trim(username_param))
     and sp.username is not null
     and sp.is_active;
$$;

revoke all on function public.auth_email_for_username(text) from public;
grant execute on function public.auth_email_for_username(text) to anon, authenticated;
