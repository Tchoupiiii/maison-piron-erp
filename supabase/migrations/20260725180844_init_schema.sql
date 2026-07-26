-- Maison Piron — schéma initial ERP/POS
-- Région EU (RGPD). Rétention comptable belge 7 ans : aucune policy DELETE
-- sur les tables financières et les journaux d'audit.

-- ============================================================
-- ENUMS
-- ============================================================
create type product_status as enum ('en_stock', 'reserve', 'vendu');
create type metal_kind as enum ('or', 'argent', 'platine');
create type metal_color as enum ('jaune', 'blanc', 'rose');
create type gemstone_type as enum ('diamant', 'emeraude', 'saphir', 'rubis', 'perle', 'autre');
create type certificate_lab as enum ('GIA', 'IGI', 'HRD', 'autre', 'aucun');
create type repair_status as enum ('check_in', 'at_bench', 'ready', 'delivered');
create type media_type as enum ('packshot', 'profil', 'porte', 'poincon', 'certificat');
create type repair_photo_phase as enum ('avant', 'apres');
create type contact_language as enum ('fr', 'nl', 'en', 'de');
create type transaction_status as enum ('brouillon', 'emise', 'payee_partielle', 'payee', 'annulee');
create type staff_role as enum ('admin', 'gemmologue', 'vendeuse');
create type sync_status as enum ('succes', 'echec', 'partiel');
create type price_change_reason as enum ('creation', 'edition_manuelle', 'sync_cours');
create type rgpd_action as enum ('anonymisation', 'export');

-- ============================================================
-- UTILITAIRES
-- ============================================================
create or replace function fn_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================
-- STAFF
-- ============================================================
create table staff_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role staff_role not null default 'vendeuse',
  created_at timestamptz not null default now()
);

-- Lecture du rôle sans déclencher la RLS de staff_profiles (évite la récursion).
create or replace function fn_current_staff_role()
returns staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.staff_profiles where id = (select auth.uid());
$$;

-- ============================================================
-- INVENTAIRE
-- ============================================================
create table products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  description text,
  status product_status not null default 'en_stock',
  showcase_slot text,
  labor_cost_eur numeric(10, 2) not null default 0,
  labor_description text,
  margin_multiplier numeric(4, 2) not null default 2.00 check (margin_multiplier > 0),
  cached_metal_cost numeric(10, 2),
  cached_stone_cost numeric(10, 2),
  cached_ht numeric(10, 2),
  cached_ttc numeric(10, 2),
  price_computed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sold_at timestamptz
);
create index on products (status);
create trigger trg_products_updated_at before update on products
  for each row execute function fn_touch_updated_at();

create table product_materials (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  metal_kind metal_kind not null,
  purity_per_mille smallint not null check (purity_per_mille between 1 and 1000),
  color metal_color,
  weight_grams numeric(8, 3) not null check (weight_grams > 0),
  detail text
);
create index on product_materials (product_id);

create table product_gemstones (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  name text not null,
  gemstone_type gemstone_type not null,
  carat_weight numeric(6, 3) not null check (carat_weight > 0),
  stone_count integer not null default 1 check (stone_count > 0),
  clarity text,
  color text,
  cut text,
  price_per_carat numeric(10, 2) not null default 0 check (price_per_carat >= 0),
  certificate_lab certificate_lab not null default 'aucun',
  certificate_number text
);
create index on product_gemstones (product_id);

create table product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  media_type media_type not null,
  storage_path text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index on product_media (product_id, position);

create table price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  computed_at timestamptz not null default now(),
  metal_cost numeric(10, 2) not null,
  stone_cost numeric(10, 2) not null,
  labor_cost numeric(10, 2) not null,
  margin_multiplier numeric(4, 2) not null,
  ht numeric(10, 2) not null,
  ttc numeric(10, 2) not null,
  reason price_change_reason not null,
  rate_date_used date
);
create index on price_history (product_id, computed_at desc);

-- ============================================================
-- CRM
-- ============================================================
create table customers (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  email text,
  phone text,
  street text,
  postal_code text,
  city text,
  country text default 'BE',
  lifetime_value numeric(12, 2) not null default 0,
  is_privilege boolean not null default false,
  is_anonymized boolean not null default false,
  anonymized_at timestamptz,
  customer_since date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- une fiche anonymisée ne peut plus porter de données identifiantes
  constraint chk_anonymized_has_no_pii check (
    not is_anonymized
    or (email is null and phone is null and street is null)
  )
);
create index on customers (is_anonymized);
create trigger trg_customers_updated_at before update on customers
  for each row execute function fn_touch_updated_at();

create table customer_preferences (
  customer_id uuid primary key references customers (id) on delete cascade,
  ring_size_eu numeric(4, 1),
  preferred_metal metal_kind,
  preferred_stone text,
  contact_language contact_language not null default 'fr'
);

create table customer_consents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  granted boolean not null,
  recorded_at timestamptz not null default now(),
  expires_at date,
  source text
);
create index on customer_consents (customer_id, recorded_at desc);

create table rgpd_action_log (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id),
  action rgpd_action not null,
  performed_by uuid references auth.users (id),
  performed_at timestamptz not null default now(),
  receipt_sent_at timestamptz,
  notes text
);
create index on rgpd_action_log (customer_id, performed_at desc);

-- ============================================================
-- ATELIER
-- ============================================================
create sequence seq_repair_ref;

create table repair_tickets (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default 'REP-' || lpad(nextval('seq_repair_ref')::text, 4, '0'),
  customer_id uuid not null references customers (id),
  product_id uuid references products (id),
  received_date date not null default current_date,
  deadline date,
  description text not null,
  status repair_status not null default 'check_in',
  estimated_price numeric(10, 2),
  actual_price numeric(10, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index on repair_tickets (status, deadline);
create index on repair_tickets (customer_id);
create trigger trg_repair_tickets_updated_at before update on repair_tickets
  for each row execute function fn_touch_updated_at();

create table repair_status_history (
  id uuid primary key default gen_random_uuid(),
  repair_ticket_id uuid not null references repair_tickets (id) on delete cascade,
  from_status repair_status,
  to_status repair_status not null,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users (id)
);
create index on repair_status_history (repair_ticket_id, changed_at desc);

create table repair_photos (
  id uuid primary key default gen_random_uuid(),
  repair_ticket_id uuid not null references repair_tickets (id) on delete cascade,
  phase repair_photo_phase not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index on repair_photos (repair_ticket_id);

-- ============================================================
-- VENTES & FACTURATION
-- ============================================================
create table transactions (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  customer_id uuid not null references customers (id),
  status transaction_status not null default 'brouillon',
  total_amount numeric(12, 2) not null default 0,
  amount_paid numeric(12, 2) not null default 0 check (amount_paid >= 0),
  outstanding_balance numeric(12, 2) generated always as (total_amount - amount_paid) stored,
  vat_rate numeric(4, 3) not null default 0.210,
  issued_at timestamptz,
  due_at date,
  sent_at timestamptz,
  pdf_storage_path text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  -- une facture émise porte forcément une référence légale
  constraint chk_emise_has_ref check (status = 'brouillon' or ref is not null)
);
create index on transactions (customer_id, created_at desc);
create index on transactions (status);

create table transaction_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions (id) on delete cascade,
  product_id uuid references products (id),
  repair_ticket_id uuid references repair_tickets (id),
  description text not null,
  unit_price_ht numeric(10, 2) not null,
  quantity integer not null default 1 check (quantity > 0),
  vat_rate numeric(4, 3) not null default 0.210,
  line_total_ht numeric(12, 2) generated always as (unit_price_ht * quantity) stored,
  line_total_ttc numeric(12, 2) generated always as (
    round(unit_price_ht * quantity * (1 + vat_rate), 2)
  ) stored,
  constraint chk_item_has_source check (
    product_id is not null or repair_ticket_id is not null
  )
);
create index on transaction_items (transaction_id);

-- lifetime_value du client = somme encaissée sur ses transactions
create or replace function fn_refresh_customer_lifetime_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := coalesce(new.customer_id, old.customer_id);
begin
  update public.customers c
     set lifetime_value = coalesce((
           select sum(t.amount_paid)
             from public.transactions t
            where t.customer_id = v_customer_id
              and t.status <> 'annulee'
         ), 0)
   where c.id = v_customer_id;
  return null;
end;
$$;

create trigger trg_transactions_lifetime_value
after insert or update of amount_paid, status or delete on transactions
for each row execute function fn_refresh_customer_lifetime_value();

-- ============================================================
-- COURS DES MÉTAUX
-- ============================================================
create table market_rates (
  id uuid primary key default gen_random_uuid(),
  metal_kind metal_kind not null,
  rate_date date not null,
  price_eur_per_gram_fine numeric(10, 4) not null check (price_eur_per_gram_fine > 0),
  source text not null,
  fetched_at timestamptz not null default now(),
  raw_response jsonb,
  unique (metal_kind, rate_date)
);
create index on market_rates (metal_kind, rate_date desc);

create table metal_sync_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  status sync_status not null,
  http_status integer,
  error_message text,
  rates_upserted integer not null default 0,
  triggered_by text not null default 'cron'
);
create index on metal_sync_log (started_at desc);

-- ============================================================
-- MOTEUR DE PRIX
-- Le cours est stocké pour le métal pur ; le titre (750‰, 925‰…)
-- est appliqué à la lecture. Miroir TS dans src/lib/pricing/engine.ts.
-- ============================================================
create or replace function calculate_dynamic_price(
  product_id_param uuid,
  rate_date_param date default null
)
returns table (
  metal_cost numeric,
  stone_cost numeric,
  labor_cost numeric,
  margin_multiplier numeric,
  ht numeric,
  ttc numeric,
  rate_date_used date,
  has_missing_rate boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_margin numeric;
  v_labor numeric;
  v_rate_date date;
  v_metal numeric;
  v_stone numeric;
  v_missing boolean;
begin
  select p.margin_multiplier, p.labor_cost_eur
    into v_margin, v_labor
    from public.products p
   where p.id = product_id_param;

  if v_margin is null then
    raise exception 'Produit introuvable : %', product_id_param;
  end if;

  -- à défaut de date fournie, le cours le plus récent disponible
  v_rate_date := coalesce(
    rate_date_param,
    (select max(mr.rate_date) from public.market_rates mr)
  );

  select
    coalesce(sum(
      pm.weight_grams * mr.price_eur_per_gram_fine * pm.purity_per_mille / 1000.0
    ), 0),
    bool_or(mr.id is null)
    into v_metal, v_missing
    from public.product_materials pm
    left join public.market_rates mr
      on mr.metal_kind = pm.metal_kind
     and mr.rate_date = v_rate_date
   where pm.product_id = product_id_param;

  select coalesce(sum(pg.carat_weight * pg.stone_count * pg.price_per_carat), 0)
    into v_stone
    from public.product_gemstones pg
   where pg.product_id = product_id_param;

  metal_cost := round(v_metal, 2);
  stone_cost := round(v_stone, 2);
  labor_cost := v_labor;
  margin_multiplier := v_margin;
  ht := round((metal_cost + stone_cost + labor_cost) * v_margin, 2);
  ttc := round(ht * 1.21, 2);
  rate_date_used := v_rate_date;
  has_missing_rate := coalesce(v_missing, false);
  return next;
end;
$$;

-- ============================================================
-- RLS — accès réservé aux employés authentifiés.
-- Pas de policy DELETE sur les tables à rétention légale.
-- ============================================================
do $$
declare
  t text;
  -- tables où la suppression reste permise (données de travail)
  deletable text[] := array[
    'products', 'product_materials', 'product_gemstones', 'product_media',
    'customers', 'customer_preferences', 'customer_consents',
    'repair_tickets', 'repair_photos', 'staff_profiles', 'market_rates'
  ];
  all_tables text[] := array[
    'staff_profiles', 'products', 'product_materials', 'product_gemstones',
    'product_media', 'price_history', 'customers', 'customer_preferences',
    'customer_consents', 'rgpd_action_log', 'repair_tickets',
    'repair_status_history', 'repair_photos', 'transactions',
    'transaction_items', 'market_rates', 'metal_sync_log'
  ];
begin
  foreach t in array all_tables loop
    execute format('alter table public.%I enable row level security', t);

    execute format(
      'create policy "staff_select" on public.%I for select to authenticated using (true)', t
    );
    execute format(
      'create policy "staff_insert" on public.%I for insert to authenticated with check (true)', t
    );
    execute format(
      'create policy "staff_update" on public.%I for update to authenticated using (true) with check (true)', t
    );

    if t = any (deletable) then
      execute format(
        'create policy "staff_delete" on public.%I for delete to authenticated using (true)', t
      );
    end if;
  end loop;
end;
$$;

-- ============================================================
-- STORAGE — buckets privés
-- ============================================================
insert into storage.buckets (id, name, public)
values ('produit_media', 'produit_media', false),
       ('repair_media', 'repair_media', false),
       ('invoices', 'invoices', false);

create policy "staff_read_media" on storage.objects
  for select to authenticated
  using (bucket_id in ('produit_media', 'repair_media', 'invoices'));

create policy "staff_write_media" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('produit_media', 'repair_media', 'invoices'));

-- les factures sont immuables : ni update ni delete sur ce bucket
create policy "staff_update_media" on storage.objects
  for update to authenticated
  using (bucket_id in ('produit_media', 'repair_media'))
  with check (bucket_id in ('produit_media', 'repair_media'));

create policy "staff_delete_media" on storage.objects
  for delete to authenticated
  using (bucket_id in ('produit_media', 'repair_media'));
