-- Action de journal pour la rétention RGPD des demandes du site
--
-- Migration isolée : une valeur ajoutée à un enum n'est pas utilisable dans la
-- transaction qui l'ajoute. La migration suivante s'en sert, donc elle part
-- seule (même règle que web_activity_actions.sql).

alter type activity_action add value if not exists 'web_enquiry_anonymisee';
