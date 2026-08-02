-- repair_tickets.actual_price : borne raisonnable par rapport à l'estimation
--
-- `atelier.modifier` autorisait n'importe quelle valeur sur actual_price (via
-- private.guard_repair_columns, qui ne contrôle que le DROIT de modifier, pas
-- la VALEUR). Rien dans l'UI n'écrit encore cette colonne aujourd'hui, mais la
-- contrainte doit vivre en base : PostgREST reste joignable directement par
-- quiconque a le droit, sans passer par l'écran.
--
-- Borne choisie : 0.5x-2x l'estimation quand elle existe. Si aucune estimation
-- n'a été posée, on se contente d'exiger un prix positif.

alter table public.repair_tickets
  add constraint repair_actual_price_bounds check (
    actual_price is null
    or (
      actual_price > 0
      and (
        estimated_price is null
        or actual_price between estimated_price * 0.5 and estimated_price * 2.0
      )
    )
  );
