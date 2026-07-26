-- Rattache un fichier de product_media à une pierre précise (certificat scanné),
-- sans quoi un certificat ne pouvait être associé qu'à la pièce entière.
alter table product_media
  add column gemstone_id uuid references product_gemstones (id) on delete cascade;

create index on product_media (gemstone_id) where gemstone_id is not null;
