-- Rate limiting applicatif sur connexion/inscription du site web (défense en
-- profondeur derrière la règle Vercel Firewall). Compte toute tentative,
-- réussie ou non, par (action, identifiant) sur une fenêtre glissante.

create table if not exists private.auth_rate_limits (
  id bigint generated always as identity primary key,
  action text not null,
  identifier text not null,
  created_at timestamptz not null default now()
);

create index if not exists auth_rate_limits_lookup
  on private.auth_rate_limits (action, identifier, created_at desc);

alter table private.auth_rate_limits enable row level security;
-- Aucune policy : ni anon ni authenticated n'ont USAGE sur le schéma
-- `private` (vérifié), donc aucun accès direct possible de toute façon.
-- RLS activée en garde-fou si ça devait changer.

create or replace function public.check_auth_rate_limit(
  action_param text,
  identifier_param text,
  max_attempts_param integer,
  window_minutes_param integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Purge best-effort, pas besoin de pg_cron pour une table à faible volume.
  delete from private.auth_rate_limits
   where created_at < now() - interval '1 day';

  insert into private.auth_rate_limits (action, identifier)
  values (action_param, lower(identifier_param));

  select count(*) into v_count
    from private.auth_rate_limits
   where action = action_param
     and identifier = lower(identifier_param)
     and created_at > now() - make_interval(mins => window_minutes_param);

  return v_count <= max_attempts_param;
end;
$$;

revoke all on function public.check_auth_rate_limit(text, text, integer, integer) from public;
grant execute on function public.check_auth_rate_limit(text, text, integer, integer) to anon, authenticated;
