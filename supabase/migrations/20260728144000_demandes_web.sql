-- Demandes reçues depuis le site
--
-- Un formulaire de contact qui ne fait qu'envoyer un e-mail se perd : le
-- message finit dans une boîte, sans suivi, sans trace de qui a répondu. Ces
-- demandes sont donc des lignes, avec un état, comme les réparations.
--
-- L'écriture passe par une RPC plutôt qu'une policy INSERT ouverte à `anon` :
-- une table publiquement insérable se remplit de spam en quelques jours. La
-- fonction porte le leurre anti-robot et la limitation de débit.

create type enquiry_kind as enum ('rendez_vous', 'question', 'estimation', 'autre');
create type enquiry_status as enum ('nouvelle', 'en_cours', 'traitee');

create table if not exists web_enquiries (
  id uuid primary key default gen_random_uuid(),
  kind enquiry_kind not null default 'question',
  full_name text not null,
  email text not null,
  phone text,
  subject text,
  message text not null,
  product_id uuid references products (id) on delete set null,
  status enquiry_status not null default 'nouvelle',
  created_at timestamptz not null default now(),
  handled_by uuid references staff_profiles (id) on delete set null,
  handled_at timestamptz,
  handled_note text
);

comment on table web_enquiries is
  'Demandes du site : rendez-vous, questions, estimations. Écriture uniquement par `web_submit_enquiry` (anon) ; lecture réservée au personnel muni de `web.demandes`.';

create index if not exists web_enquiries_status_idx on web_enquiries (status, created_at desc);
create index if not exists web_enquiries_email_idx on web_enquiries (lower(email), created_at desc);

alter table web_enquiries enable row level security;

create policy "staff_select" on web_enquiries for select to authenticated
  using ((select private.has_permission('web.demandes')));
create policy "staff_update" on web_enquiries for update to authenticated
  using ((select private.has_permission('web.demandes')))
  with check ((select private.has_permission('web.demandes')));

-- Aucune policy d'insertion, volontairement : tout passe par la fonction.
create or replace function public.web_submit_enquiry(
  kind_param enquiry_kind,
  full_name_param text,
  email_param text,
  message_param text,
  phone_param text default null,
  subject_param text default null,
  product_slug_param text default null,
  honeypot_param text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(email_param, '')));
  v_name text := btrim(coalesce(full_name_param, ''));
  v_message text := btrim(coalesce(message_param, ''));
  v_product uuid;
  v_recent integer;
  v_id uuid;
begin
  -- Champ leurre : invisible dans le formulaire, rempli par les robots. On
  -- renvoie un identifiant crédible plutôt qu'une erreur — inutile de leur
  -- apprendre à contourner.
  if coalesce(btrim(honeypot_param), '') <> '' then
    return gen_random_uuid();
  end if;

  if v_name = '' or v_message = '' then
    raise exception 'Nom et message sont nécessaires';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z]{2,}$' then
    raise exception 'Adresse e-mail invalide';
  end if;
  if length(v_message) > 4000 then
    raise exception 'Message trop long';
  end if;

  -- Limitation de débit : cinq demandes par heure et par adresse. Assez pour
  -- une personne qui se reprend, trop peu pour un robot.
  select count(*) into v_recent
    from public.web_enquiries e
   where lower(e.email) = v_email
     and e.created_at > now() - interval '1 hour';

  if v_recent >= 5 then
    raise exception 'Trop de demandes envoyées récemment. Appelez-nous, nous répondrons plus vite.';
  end if;

  if product_slug_param is not null then
    select p.id into v_product
      from public.products p
     where p.web_slug = product_slug_param and p.web_published;
  end if;

  insert into public.web_enquiries (
    kind, full_name, email, phone, subject, message, product_id
  ) values (
    coalesce(kind_param, 'question'), left(v_name, 120), v_email,
    nullif(btrim(phone_param), ''), nullif(btrim(subject_param), ''),
    v_message, v_product
  )
  returning id into v_id;

  perform private.log_web_activity(
    'web_demande_recue',
    'Demande ' || coalesce(kind_param::text, 'question') || ' de ' || left(v_name, 120),
    'web_enquiry', v_id, v_email);

  return v_id;
end;
$$;

revoke all on function public.web_submit_enquiry(
  enquiry_kind, text, text, text, text, text, text, text) from public;
grant execute on function public.web_submit_enquiry(
  enquiry_kind, text, text, text, text, text, text, text) to anon, authenticated;

-- Traiter une demande, c'est signer : qui a répondu, et quand.
create or replace function public.set_enquiry_status(
  enquiry_id_param uuid,
  status_param enquiry_status,
  note_param text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('web.demandes') then
    raise exception 'Vous n''avez pas le droit de traiter les demandes du site';
  end if;

  update public.web_enquiries
     set status = status_param,
         handled_note = coalesce(nullif(btrim(note_param), ''), handled_note),
         handled_by = case when status_param = 'nouvelle' then null else (select auth.uid()) end,
         handled_at = case when status_param = 'nouvelle' then null else now() end
   where id = enquiry_id_param;
end;
$$;

revoke all on function public.set_enquiry_status(uuid, enquiry_status, text) from public, anon;
grant execute on function public.set_enquiry_status(uuid, enquiry_status, text) to authenticated;
