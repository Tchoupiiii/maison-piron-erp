-- Actions de journal propres au site
--
-- Migration isolée : une valeur ajoutée à un enum n'est pas utilisable dans la
-- transaction qui l'ajoute. Les migrations suivantes s'en servent, donc elle
-- part seule.

alter type activity_action add value if not exists 'web_produit_publie';
alter type activity_action add value if not exists 'web_commande_payee';
alter type activity_action add value if not exists 'web_commande_echouee';
alter type activity_action add value if not exists 'web_demande_recue';
alter type activity_action add value if not exists 'web_marque_modifiee';
