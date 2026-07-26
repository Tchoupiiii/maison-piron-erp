-- Données de démonstration reprises de la maquette (design-reference).
-- Prévu pour une base vierge : rejoué tel quel, il dupliquerait les clients
-- et les journaux, d'où le garde-fou ci-dessous.
do $$
begin
  if exists (select 1 from customers) then
    raise exception 'Seed déjà appliqué : videz les tables avant de le rejouer';
  end if;
end;
$$;

-- ── Cours des métaux : 90 jours d'historique, or 24k ≈ 82,40 €/g le 25.07.2026
insert into market_rates (metal_kind, rate_date, price_eur_per_gram_fine, source)
select
  m.kind,
  d::date,
  round((m.base * (1 + 0.048 * (d::date - (current_date - 89)) / 89.0
        + 0.02 * sin((d::date - (current_date - 89)) / 7.0)))::numeric, 4),
  'seed'
from generate_series(current_date - 89, current_date, interval '1 day') d
cross join (values
  ('or'::metal_kind, 82.40),
  ('argent'::metal_kind, 1.0500),
  ('platine'::metal_kind, 30.5000)
) as m(kind, base)
on conflict (metal_kind, rate_date) do nothing;

insert into metal_sync_log (started_at, finished_at, duration_ms, status, http_status, rates_upserted, triggered_by)
values
  (now() - interval '6 hours', now() - interval '6 hours' + interval '412 milliseconds', 412, 'succes', 200, 3, 'cron'),
  (now() - interval '1 day 6 hours', now() - interval '1 day 6 hours' + interval '388 milliseconds', 388, 'succes', 200, 3, 'cron'),
  (now() - interval '2 days 6 hours', now() - interval '2 days 6 hours' + interval '1204 milliseconds', 1204, 'partiel', 200, 2, 'cron'),
  (now() - interval '3 days 6 hours', now() - interval '3 days 6 hours' + interval '297 milliseconds', 297, 'succes', 200, 3, 'cron'),
  (now() - interval '4 days 6 hours', now() - interval '4 days 6 hours' + interval '5011 milliseconds', 5011, 'echec', 429, 0, 'cron');

-- ── Clientèle
insert into customers (full_name, email, phone, street, postal_code, city, is_privilege, customer_since)
values
  ('Camille Delvaux', 'camille.delvaux@example.be', '+32 470 11 22 33', 'Rue de Chênée 18', '4032', 'Chênée', true, '2019-03-09'),
  ('Marc Vanderheyden', 'marc.vanderheyden@example.be', '+32 471 22 33 44', 'Quai de Rome 7', '4000', 'Liège', false, '2021-11-02'),
  ('Fatima Cherkaoui', 'fatima.cherkaoui@example.be', '+32 472 33 44 55', 'Rue Sart-Tilman 91', '4031', 'Angleur', true, '2020-06-18'),
  ('Bernard Grosjean', 'bernard.grosjean@example.be', '+32 473 44 55 66', 'Rue Outremeuse 3', '4020', 'Liège', false, '2022-01-14'),
  ('Nadia Leclercq', 'nadia.leclercq@example.be', '+32 474 55 66 77', 'Rue du Perron 22', '4000', 'Liège', false, '2023-09-30'),
  ('Élise Dumoulin', 'elise.dumoulin@example.be', '+32 475 66 77 88', 'Rue des Vennes 44', '4020', 'Liège', false, '2024-04-05')
on conflict do nothing;

insert into customer_preferences (customer_id, ring_size_eu, preferred_metal, preferred_stone, contact_language)
select id, 54.0, 'or'::metal_kind, 'Diamant, émeraude', 'fr'::contact_language from customers where full_name = 'Camille Delvaux'
union all
select id, 62.0, 'platine'::metal_kind, 'Saphir', 'nl'::contact_language from customers where full_name = 'Marc Vanderheyden'
union all
select id, 51.0, 'or'::metal_kind, 'Émeraude', 'fr'::contact_language from customers where full_name = 'Fatima Cherkaoui'
on conflict (customer_id) do nothing;

insert into customer_consents (customer_id, granted, recorded_at, expires_at, source)
select id, true, '2026-07-12', '2029-07-12', 'formulaire boutique'
from customers where full_name = 'Camille Delvaux';

-- ── Inventaire
insert into products (sku, name, description, status, showcase_slot, labor_cost_eur, labor_description, margin_multiplier)
values
  ('MP-BAG-0412', 'Solitaire Cointe',
   'Monture six griffes en or blanc 18k, réalisée à l''atelier d''Outremeuse. Diamant taille brillant certifié IGI, serti en juin 2026.',
   'en_stock', 'vitrine 2', 620.00, '14 h serti + polissage', 2.10),
  ('MP-BCL-0341', 'Créoles Sart-Tilman',
   'Créoles en or rose 18k serties de saphirs taille brillant.',
   'en_stock', 'vitrine 1', 280.00, '6 h serti', 2.30),
  ('MP-BRA-0157', 'Bracelet Perron',
   'Bracelet argent 925 orné d''un onyx taille cabochon.',
   'en_stock', 'vitrine 3', 140.00, '3 h montage', 2.60),
  ('MP-PEN-0204', 'Pendentif Coteaux',
   'Pendentif or blanc 18k, émeraude de Colombie taille émeraude.',
   'reserve', 'coffre', 410.00, '9 h serti', 2.05),
  ('MP-COL-0288', 'Collier Meuse',
   'Collier or jaune 18k, maille vénitienne réalisée main.',
   'vendu', null, 520.00, '12 h montage + polissage', 2.15),
  ('MP-BAG-0399', 'Alliance Outremeuse',
   'Alliance platine 950, gravure main.',
   'vendu', null, 260.00, '5 h gravure', 2.40),
  ('MP-BCL-0290', 'Créoles Laveu',
   'Créoles or jaune 18k, finition satinée.',
   'vendu', null, 190.00, '4 h finition', 2.35),
  ('MP-BRA-0142', 'Bracelet Vennes',
   'Chaîne argent 925, fermoir mousqueton or 18k.',
   'vendu', null, 90.00, '2 h montage', 2.70),
  ('MP-COL-0301', 'Collier Chartreuse',
   'Collier or blanc 18k, pavage diamants.',
   'vendu', null, 640.00, '16 h pavage', 2.05)
on conflict (sku) do nothing;

update products set sold_at = now() - interval '13 days' where status = 'vendu' and sold_at is null;

insert into product_materials (product_id, metal_kind, purity_per_mille, color, weight_grams, detail)
select id, 'or'::metal_kind, 750, 'blanc'::metal_color, 6.400, '750 ‰ · rhodié' from products where sku = 'MP-BAG-0412'
union all select id, 'platine'::metal_kind, 950, null::metal_color, 0.400, 'griffes serti' from products where sku = 'MP-BAG-0412'
union all select id, 'or', 750, 'rose', 4.200, '750 ‰' from products where sku = 'MP-BCL-0341'
union all select id, 'argent', 925, null, 18.600, '925 ‰' from products where sku = 'MP-BRA-0157'
union all select id, 'or', 750, 'blanc', 3.800, '750 ‰ · rhodié' from products where sku = 'MP-PEN-0204'
union all select id, 'or', 750, 'jaune', 22.400, '750 ‰' from products where sku = 'MP-COL-0288'
union all select id, 'platine', 950, null, 7.100, '950 ‰' from products where sku = 'MP-BAG-0399'
union all select id, 'or', 750, 'jaune', 5.300, '750 ‰ · satiné' from products where sku = 'MP-BCL-0290'
union all select id, 'argent', 925, null, 11.200, '925 ‰' from products where sku = 'MP-BRA-0142'
union all select id, 'or', 750, 'blanc', 14.900, '750 ‰ · rhodié' from products where sku = 'MP-COL-0301';

insert into product_gemstones (product_id, name, gemstone_type, carat_weight, stone_count, clarity, color, cut, price_per_carat, certificate_lab, certificate_number)
select id, 'Diamant taille brillant', 'diamant'::gemstone_type, 0.720, 1, 'VVS1', 'D', 'Excellent', 6740.00, 'IGI'::certificate_lab, '552418907'
  from products where sku = 'MP-BAG-0412'
union all
select id, 'Diamants pavage', 'diamant', 0.015, 12, 'VS2', 'F', 'Brillant', 3100.00, 'aucun', null
  from products where sku = 'MP-BAG-0412'
union all
select id, 'Saphirs', 'saphir', 0.240, 2, 'VS', 'Bleu royal', 'Brillant', 1850.00, 'aucun', null
  from products where sku = 'MP-BCL-0341'
union all
select id, 'Onyx', 'autre', 2.400, 1, null, 'Noir', 'Cabochon', 45.00, 'aucun', null
  from products where sku = 'MP-BRA-0157'
union all
select id, 'Émeraude de Colombie', 'emeraude', 1.020, 1, 'VS', 'Vert intense', 'Émeraude', 7900.00, 'GIA', '2215487763'
  from products where sku = 'MP-PEN-0204'
union all
select id, 'Diamants pavage', 'diamant', 0.020, 34, 'VS1', 'E', 'Brillant', 3400.00, 'aucun', null
  from products where sku = 'MP-COL-0301';

-- ── Atelier : refs de la maquette, la séquence reprend ensuite
insert into repair_tickets (ref, customer_id, description, received_date, deadline, status, estimated_price)
select 'REP-0912', id, 'Resserrage chaînette + polissage collier or 18k', current_date - 12, current_date - 2, 'check_in'::repair_status, 145.00
  from customers where full_name = 'Élise Dumoulin'
union all
select 'REP-0915', id, 'Remplacement griffe cassée, solitaire 0,50 ct', current_date - 5, current_date + 4, 'check_in', 320.00
  from customers where full_name = 'Marc Vanderheyden'
union all
select 'REP-0908', id, 'Mise à taille 52 → 54, alliance platine', current_date - 15, current_date + 1, 'at_bench', 210.00
  from customers where full_name = 'Camille Delvaux'
union all
select 'REP-0903', id, 'Rhodiage complet parure or blanc', current_date - 18, current_date + 9, 'at_bench', 260.00
  from customers where full_name = 'Fatima Cherkaoui'
union all
select 'REP-0897', id, 'Refixation saphir + contrôle serti', current_date - 21, current_date + 3, 'ready', 180.00
  from customers where full_name = 'Bernard Grosjean'
union all
select 'REP-0881', id, 'Nettoyage ultrasons, chaîne argent 925', current_date - 30, current_date + 12, 'delivered', 45.00
  from customers where full_name = 'Nadia Leclercq'
on conflict (ref) do nothing;

select setval('seq_repair_ref', 916, true);

insert into repair_status_history (repair_ticket_id, from_status, to_status, changed_at)
select id, null::repair_status, 'check_in'::repair_status, created_at from repair_tickets;

insert into repair_status_history (repair_ticket_id, from_status, to_status, changed_at)
select id, 'check_in'::repair_status, 'at_bench'::repair_status, created_at + interval '2 days'
  from repair_tickets where status in ('at_bench', 'ready', 'delivered');

insert into repair_status_history (repair_ticket_id, from_status, to_status, changed_at)
select id, 'at_bench'::repair_status, 'ready'::repair_status, created_at + interval '5 days'
  from repair_tickets where status in ('ready', 'delivered');

insert into repair_status_history (repair_ticket_id, from_status, to_status, changed_at)
select id, 'ready'::repair_status, 'delivered'::repair_status, created_at + interval '8 days'
  from repair_tickets where status = 'delivered';

-- ── Ventes : une facture par pièce vendue
insert into transactions (ref, customer_id, status, total_amount, amount_paid, issued_at, due_at, sent_at, created_at)
select 'FA-2026-0184', c.id, 'payee'::transaction_status, 0, 0, now() - interval '13 days', (current_date - 13 + 14), now() - interval '13 days', now() - interval '13 days'
  from customers c where c.full_name = 'Camille Delvaux'
union all
select 'FA-2026-0181', c.id, 'payee_partielle', 0, 0, now() - interval '16 days', (current_date - 16 + 14), now() - interval '16 days', now() - interval '16 days'
  from customers c where c.full_name = 'Marc Vanderheyden'
union all
select 'FA-2026-0178', c.id, 'payee', 0, 0, now() - interval '19 days', (current_date - 19 + 14), now() - interval '19 days', now() - interval '19 days'
  from customers c where c.full_name = 'Fatima Cherkaoui'
union all
select 'FA-2026-0174', c.id, 'payee_partielle', 0, 0, now() - interval '23 days', (current_date - 23 + 14), now() - interval '23 days', now() - interval '23 days'
  from customers c where c.full_name = 'Bernard Grosjean'
union all
select 'FA-2026-0169', c.id, 'payee', 0, 0, now() - interval '28 days', (current_date - 28 + 14), now() - interval '28 days', now() - interval '28 days'
  from customers c where c.full_name = 'Nadia Leclercq'
on conflict (ref) do nothing;

insert into transaction_items (transaction_id, product_id, description, unit_price_ht, quantity)
select t.id, p.id, p.name || ' · ' || p.sku, round(9860.00 / 1.21, 2), 1
  from transactions t, products p where t.ref = 'FA-2026-0184' and p.sku = 'MP-COL-0288'
union all
select t.id, p.id, p.name || ' · ' || p.sku, round(12400.00 / 1.21, 2), 1
  from transactions t, products p where t.ref = 'FA-2026-0181' and p.sku = 'MP-COL-0301'
union all
select t.id, p.id, p.name || ' · ' || p.sku, round(4720.00 / 1.21, 2), 1
  from transactions t, products p where t.ref = 'FA-2026-0178' and p.sku = 'MP-BCL-0290'
union all
select t.id, p.id, p.name || ' · ' || p.sku, round(3180.00 / 1.21, 2), 1
  from transactions t, products p where t.ref = 'FA-2026-0174' and p.sku = 'MP-BAG-0399'
union all
select t.id, p.id, p.name || ' · ' || p.sku, round(1240.00 / 1.21, 2), 1
  from transactions t, products p where t.ref = 'FA-2026-0169' and p.sku = 'MP-BRA-0142';

-- le total suit les lignes, jamais l'inverse
update transactions t
   set total_amount = coalesce(l.sum_ttc, 0)
  from (select transaction_id, sum(line_total_ttc) as sum_ttc
          from transaction_items group by transaction_id) l
 where l.transaction_id = t.id;

update transactions set amount_paid = total_amount where status = 'payee';
update transactions set amount_paid = round(total_amount * 0.30, 2) where ref = 'FA-2026-0181';
update transactions set amount_paid = round(total_amount * 0.50, 2) where ref = 'FA-2026-0174';

-- ── Prix en cache + historique, calculés par la RPC
insert into price_history (product_id, metal_cost, stone_cost, labor_cost, margin_multiplier, ht, ttc, reason, rate_date_used)
select p.id, c.metal_cost, c.stone_cost, c.labor_cost, c.margin_multiplier, c.ht, c.ttc, 'creation', c.rate_date_used
  from products p
 cross join lateral calculate_dynamic_price(p.id) c;

update products p
   set cached_metal_cost = c.metal_cost,
       cached_stone_cost = c.stone_cost,
       cached_ht = c.ht,
       cached_ttc = c.ttc,
       price_computed_at = now()
  from (
    select p2.id, c2.*
      from products p2
     cross join lateral calculate_dynamic_price(p2.id) c2
  ) c
 where c.id = p.id;
