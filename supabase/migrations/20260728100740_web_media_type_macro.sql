-- La galerie du site montre quatre vues. Trois existent déjà dans l'enum
-- (packshot, profil, porte) ; il manquait la macro de la pierre centrale.
-- Isolée dans sa propre migration : une valeur d'enum ajoutée ne peut pas
-- être utilisée dans la transaction qui la crée.
alter type media_type add value if not exists 'macro';
