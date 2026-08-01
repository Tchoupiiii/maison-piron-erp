# Maison Piron — ERP / POS

ERP et point de vente de la Maison Piron (bijouterie, Liège).
Next.js 16 (App Router) + Supabase (PostgreSQL, Auth, Storage, RLS), hébergé sur Vercel.
Le design suit `../design-reference/uploads/DESIGN-ERP.md` (shadcn/ui monochrome, Geist).

En ligne : **https://maison-piron-erp.vercel.app** (projet Vercel
`tchoupiiiis-projects/maison-piron-erp`, région `fra1`).

## Démarrer

```bash
npm --prefix app run dev
```

Copier `.env.example` vers `.env.local` et compléter.

| Variable | Rôle | État |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL du projet | renseignée |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | clé publique, soumise à la RLS | renseignée |
| `SUPABASE_SERVICE_ROLE_KEY` | contourne la RLS ; **serveur uniquement**. Nécessaire au Cron des cours et à la *création* d'un compte employé | renseignée |
| `RESEND_API_KEY` | envoi des e-mails clients | renseignée |
| `RESEND_FROM` | expéditeur ; le domaine doit être vérifié chez Resend | à vérifier |
| `ADMIN_ALERT_EMAIL` | destinataire des alertes d'échec de sync | **vide** |
| `METALPRICE_API_KEY` | fournisseur de secours ; inutile tant que gold-api répond | vide, volontaire |
| `CRON_SECRET` | jeton attendu par `/api/cron/metal-rates` | généré |

Les mêmes valeurs sont déjà poussées dans Vercel (production, preview,
development) via `vercel env add`.

## Base de données

Projet Supabase `maison-piron-erp` (`ddoenisiniofxzjnqjqu`), région **eu-central-1**
(Francfort) — obligation RGPD de traiter les données dans l'UE.

- Migrations : `supabase/migrations/`
- Données de démonstration : `supabase/seed.sql` (déjà appliquées)

Régénérer les types après toute migration :

```bash
npx supabase gen types typescript --project-id ddoenisiniofxzjnqjqu > src/types/database.types.ts
```

### Accès, rôles et permissions

Un compte authentifié ne suffit pas : la RLS exige une ligne **active** dans
`staff_profiles`. Un compte sans fiche employé ne voit **aucune** donnée.
Les comptes se créent depuis Réglages → Employés ; en dépannage :

```sql
insert into staff_profiles (id, full_name, email, role)
select id, 'Prénom Nom', email, 'vendeuse'   -- ou 'gemmologue' / 'admin'
  from auth.users where email = 'adresse@maisonpiron.be';
```

Les employés se connectent avec un **identifiant**, pas une adresse e-mail : un
vendeur en boutique n'a pas de messagerie professionnelle. Supabase Auth exigeant
malgré tout une adresse, chaque identifiant est adossé à une adresse technique
`<identifiant>@maison-piron.invalid` — domaine réservé par la RFC 2606, donc
jamais délivrable — que personne ne voit ni ne saisit. `auth_email_for_username()`
fait la traduction ; elle n'expose que ces adresses internes, jamais l'adresse
réelle d'un compte qui se connecte par e-mail. Le champ `staff_profiles.email`
devient une simple adresse de contact, facultative.

Le droit d'agir se lit dans `private.has_permission(clé)` :

1. rôle `admin` → vrai, sans condition ;
2. sinon exception nominative `staff_permissions` (accordé / retiré) ;
3. sinon défaut du rôle `role_permissions` ;
4. sinon faux. Et toujours faux si `is_active = false`.

Les 26 clés vivent dans `permission_catalogue` (6 catégories) et sont reprises
côté TypeScript dans `src/lib/permissions.ts`.

### Trois couches d'autorisation, pas une

L'absence d'un bouton n'est pas une sécurité. Chaque geste sensible est refusé
trois fois :

| Couche | Mécanisme | Ce qu'elle attrape |
|---|---|---|
| Ligne | policies RLS appelant `has_permission()` | lecture ou écriture d'une table entière |
| Colonne | triggers `BEFORE UPDATE` `private.guard_*_columns()` | l'employé qui a le droit de changer le *statut* d'une pièce et en profite pour changer sa *marge* |
| Écriture d'argent | RPC `security definer` (`create_sale`, `record_payment`, `emit_invoice`, `set_product_status`, `set_repair_status`) | `transactions` et `transaction_items` n'ont **aucune** policy INSERT/UPDATE/DELETE : rien ne s'écrit hors de ces fonctions |

La deuxième couche existe parce que la RLS de PostgreSQL est **par ligne, pas par
colonne** : une policy `UPDATE` accordée pour changer un statut accorde en réalité
toute la ligne. Vérifié avec un jeton vendeuse : `PATCH /products` sur
`margin_multiplier` répond `Vous n'avez pas le droit de modifier les prix`.

Les advisors Supabase signalent 13 `authenticated_security_definer_function_executable`.
C'est **voulu** : ces RPC sont exposées à `authenticated` mais s'auto-autorisent en
interne (`private.require_admin()` ou `has_permission()`). `admin_active_sessions()`
appelée par une vendeuse répond `Action réservée aux administrateurs`.

### Journal d'activité

`activity_log` n'a **aucune policy INSERT** : les lignes ne peuvent être écrites que
par `public.log_activity()`, qui estampille elle-même `auth.uid()`, le nom et le rôle.
Un employé ne peut donc pas forger une entrée via `/rest/v1` (essai → `42501`).
Aucune policy UPDATE ni DELETE : le journal est en ajout seul. L'IP vient de
`x-forwarded-for` et l'instantané `actor_name` survit à la suppression du compte.

Les échecs de connexion ne sont pas journalisés en base — cela imposerait d'ouvrir
un INSERT à `anon`, donc un vecteur d'inondation. Ils restent dans les logs Auth
Supabase.

Les sessions en cours (qui, depuis quelle IP, quel appareil) viennent de
`auth.sessions` via `admin_active_sessions()` — `auth.audit_log_entries` n'est pas
persistée sur GoTrue hébergé.

### Rétention comptable

Les tables `transactions`, `transaction_items`, `price_history`, `rgpd_action_log`,
`repair_status_history` et `metal_sync_log` n'ont **aucune policy DELETE** : la
suppression est impossible depuis l'application, conformément à l'obligation de
conservation de 7 ans (art. 60 CTVA). Le bucket `invoices` est en écriture seule.

### RGPD

`anonymizeCustomer` efface nom, e-mail, téléphone, adresse et préférences, mais
conserve la ligne client et son identifiant : les factures liées restent
intégralement auditables. Le reçu d'exécution part **avant** l'effacement — si
l'envoi échoue, l'anonymisation est interrompue.

## Moteur de prix

```
metal   = Σ (poids_g × cours_du_métal_pur × titre / 1000)
pierres = Σ (carats × nombre × prix_au_carat)
HT      = (metal + pierres + façon) × coefficient_maison
TTC     = HT × 1,21
```

Le cours est stocké pour le **métal pur** (999 ‰) ; le titre est appliqué à la
lecture, donc l'or 18k vaut le cours × 0,750.

Deux implémentations, volontairement redondantes :

- `calculate_dynamic_price()` (SQL) — **seule source de vérité**, appelée par toute
  action qui persiste un prix ou crée une vente.
- `src/lib/pricing/engine.ts` — miroir TypeScript, uniquement pour l'aperçu
  interactif des curseurs de la fiche pièce. Ne persiste rien.

Les deux ont été vérifiées identiques au centime sur les pièces du seed.

## Cours des métaux

Fournisseur : **gold-api.com** (USD par once troy, or / argent / platine), converti
en euros par les références BCE publiées par **Frankfurter**. Aucune clé, aucune
inscription, aucun quota — donc aucune coupure le jour où une offre gratuite
s'épuise. MetalpriceAPI ne sert de secours que si `METALPRICE_API_KEY` est
renseignée.

```
€/g fin = USD/oz × (EUR/USD) ÷ 31,1035
```

`GET /api/cron/metal-rates`, protégé par `Authorization: Bearer $CRON_SECRET`,
planifié à 6 h dans `vercel.json`. La même logique (`src/lib/metals/sync.ts`)
alimente le bouton « Forcer une synchronisation », qui passe lui par la session de
l'employé et ne dépend donc pas de la clé service_role.

Chaque exécution écrit `market_rates` avec la charge utile réelle dans
`raw_response` et `source = 'gold-api'`, plus une ligne `metal_sync_log` portant une
durée **mesurée** et son origine (`cron` ou `manuel`). Les données de démonstration
restent identifiables par `source = 'seed'`. Un échec déclenche une alerte e-mail :
un cours périmé fige les prix de vente sans que personne ne le voie.

**Le recalcul des étiquettes n'est jamais automatique.** Un cours qui monte ne doit
pas changer un prix en vitrine sans décision de la maison : l'écran affiche combien
de pièces portent encore leur ancien prix, et l'admin déclenche le recalcul.

### N'importe quel titre

`metal_titles` liste les titres légaux — or 375/417/585/750/833/916/999 (9 à
24 carats), argent 800/830/925/999, platine 850/900/950/999 — et alimente le
sélecteur de la fiche pièce ainsi que le convertisseur de l'écran Cours des métaux.
`purity_per_mille` reste un entier libre de 1 à 1000 : un titre hors référentiel
reste saisissable.

## Structure

```
src/
  actions/          Server Actions ; auth-guard expose requirePermission(clé)
                    activity.ts n'est PAS "use server" — sinon ce serait un
                    point d'entrée public de journalisation
  app/
    (backoffice)/   sidebar + écrans ERP + /reglages (onglets admin), plus
                    /commandes-web et /demandes, alimentés par le site
    api/cron/       metal-rates (quotidien), holds (quart d'heure)
    auth/login/
    not-found.tsx   404 maison (une variante aussi dans (backoffice))
  components/       ui.tsx (primitives partagées), permission-matrix,
                    rate-converter, price-simulator, rgpd-dialog,
                    web-media-upload-form (photos de vitrine)
  lib/
    supabase/       clients serveur, navigateur, proxy
    pricing/        moteur d'aperçu
    metals/sync.ts  récupération des cours, partagée cron + bouton manuel
    permissions.ts  catalogue des 26 clés, libellés, navigation filtrée
    email/          Resend + gabarits
    constants.ts    mentions légales, TVA, libellés
  types/            types générés depuis la base
  proxy.ts          garde d'authentification (ex-middleware, renommé en Next.js 16)
```

### Trois applications, une base

La caisse a été extraite de cette application (commit `ea3931f`) : elle vit dans
`../pos`, et le site public dans `../../Site Web/web`. Les trois partagent le même
projet Supabase, les mêmes comptes et les mêmes fonctions métier — c'est la base
qui porte les règles, pas les applications.

| | Répertoire | Port | Rôle |
|---|---|---|---|
| ERP | `ERP/app` | 3000 | inventaire, clientèle, ventes, réglages |
| Caisse | `ERP/pos` | 3001 | encaissement tactile, scan, ticket |
| Site | `Site Web/web` | 3002 | vitrine publique et vente en ligne |

Les migrations restent **ici**, dans `supabase/migrations/` : source de vérité
unique du schéma pour les trois. Après chaque migration, régénérer
`src/types/database.types.ts` dans les trois dépôts — les fichiers doivent rester
identiques.

## Stock : scanner réserve en boutique, payer décrémente partout

Les pièces de la maison sont uniques : une ligne `products` = un bijou. Le stock
négatif est donc impossible **par construction**, à une condition — que la
transition vers `vendu` soit sérialisée. C'est le rôle du `select … for update`
de `private.create_sale_core` : si la boutique et le site encaissent la même
pièce à la même seconde, la seconde transaction attend, relit le statut et
échoue proprement. L'un des deux est refusé, jamais les deux acceptés.

| Geste | Table `products` | Vendable ? | Écriture |
|---|---|---|---|
| Scan en boutique (code-barres **ou** RFID) | inchangée, `en_stock` | non | `stock_holds`, 15 min |
| Ajout au panier sur le site | inchangée | oui | rien — le panier web ne réserve pas |
| Retrait du panier boutique / abandon / expiration | inchangée | oui à nouveau | `stock_holds.released_at` |
| **Paiement** (caisse ou site) | → `vendu` | non | c'est **ici**, et seulement ici, que le stock baisse |
| Retour | → `en_stock` | oui à nouveau | note de crédit `AV-` |

Le verrou métier n'est pas du code applicatif : c'est un **index unique partiel**
`stock_holds (product_id) where released_at is null`. PostgreSQL arbitre lui-même
— aucun navigateur, aucun onglet, aucune API tierce ne peut le contourner.

Un admin peut vider un panier boutique ou en retirer une pièce depuis
Réglages → Caisses → « Paniers en cours », par exemple si une caisse a planté
avant de libérer proprement ce qu'elle tenait. Le geste est journalisé à part
(`panier_libere`), pour se distinguer d'un abandon normal.

### Panier web : aucune réservation avant le paiement

Décision assumée : mettre une pièce au panier sur le site n'a **aucun** effet
sur sa disponibilité, ni en boutique ni en ligne. Seul un paiement réellement
confirmé — caisse ou webhook Mollie — fait basculer la pièce en `vendu`. Le
risque accepté en échange : un paiement en ligne peut, rarement, échouer parce
que la pièce vient d'être vendue en boutique dans l'intervalle ; il se rattrape
par un remboursement, jamais par une pièce affichée « indisponible » à tort
pendant qu'un visiteur la regardait sans acheter.

`web_hold_product` garde son nom historique (le site en dépend) mais ne pose
plus de `stock_holds` : c'est une mise au panier, pas une réservation.
`web_begin_checkout` vérifie la disponibilité en temps réel juste avant
d'envoyer vers le paiement — un dernier coup d'œil avant de risquer un
remboursement, pas une garantie. La garantie réelle reste `create_sale_core`,
sous verrou, au moment du paiement.

### Ce que le site web interroge

Le site ne peut pas passer par `product_availability` : cette vue est
`security_invoker`, donc soumise à la RLS de `products`, qui ne répond rien à un
visiteur anonyme. Il lit des vues **security definer** dédiées — `web_catalogue`,
`web_brands`, `web_product_media`, `web_product_stones`, `web_maison` — accordées
à `anon` et n'exposant que le TTC. Aucun champ de coût n'y figure.

Il ne peut pas non plus appeler `scan_product` ni `create_sale`, qui exigent
`ventes.creer`. D'où le découpage :

- `private.create_sale_core` porte toute la logique de vente — verrou
  `for update`, contrôle des réservations, numérotation, mouvements de stock —
  **sans aucun contrôle de permission**. Aucun grant : seules des fonctions
  security definer l'atteignent.
- `public.create_sale` est désormais un mince gardien : il vérifie `ventes.creer`
  (et `ventes.facturer` le cas échéant) puis délègue. Signature inchangée, donc
  droits conservés — la caisse et l'ERP n'ont rien à changer.
- `web_hold_product`, `web_release`, `web_cart` gèrent le panier sans exiger de
  permission : c'est le `cart_ref` qui autorise. Son format `WEB-<uuid>` est
  imposé côté SQL, pour qu'un visiteur ne puisse pas présenter celui d'une caisse.
- `web_confirm_paid` appelle le cœur directement, **sous clé service_role
  uniquement**, depuis le seul webhook Mollie.

Deux réglages accompagnent l'ouverture au public :

- un trigger sur `auth.users` refuse le domaine `@maison-piron.invalid` à toute
  inscription qui ne porte pas `raw_app_meta_data.staff = true` — drapeau que
  seule l'API admin peut poser. Sans lui, un inconnu pourrait déposer
  `camille@maison-piron.invalid` et bloquer la création de ce compte employé.
  `createStaffAccount` pose ce drapeau : ne pas le retirer.
- le cron `/api/cron/holds` libère les réservations boutique expirées toutes
  les quinze minutes, pour le cas où la boutique est fermée et où personne ne
  scanne plus pour déclencher `release_expired_holds()`. Il referme aussi les
  commandes web dont le paiement a été abandonné plus de 30 minutes — un
  simple panier, lui, n'a rien à expirer puisqu'il ne retient aucune pièce.

### Retours

`return_sold_item()` émet une note de crédit `AV-AAAA-nnnn` à montant négatif et
remet la pièce en stock. La vente d'origine n'est ni modifiée ni supprimée —
obligation de conservation, art. 60 CTVA. Les montants négatifs ne sont admis que
sur les documents dont la référence commence par `AV-` ; une vente ordinaire reste
interdite de négatif. Réservé par défaut au gemmologue et à l'admin
(`ventes.retour`), accordable nominativement à un vendeur.

`stock_movements` conserve la trace de chaque geste : entrée, réservation,
libération, vente, retour — avec le canal, le panier et l'auteur.

## Certificats de pierre : deux documents distincts

Une même pierre certifiée porte deux pièces séparées, jamais confondues :

| Document | Où | Contenu |
|---|---|---|
| **Scan du labo** (PDF/photo) | fiche pièce, par pierre | le fichier original tel qu'émis par GIA/IGI/HRD, stocké tel quel |
| **Certificat imprimable Maison Piron** | `/inventaire/[productId]/certificat/[gemstoneId]` | mise en forme maison des caractéristiques (type, poids, pureté, couleur, taille, labo), sans prix, à remettre au client |

Le scan s'appuie sur la table `product_media` (déjà présente dans le schéma
initial, jamais câblée jusqu'ici) et le bucket privé `produit_media` : upload et
suppression passent par `uploadGemstoneCertificate`/`deleteGemstoneCertificate`,
gardés par `inventaire.modifier`, lecture par URL signée (5 min) via
`inventaire.voir`. La colonne `product_media.gemstone_id` rattache le fichier à
une pierre précise — une pièce à plusieurs pierres peut avoir un scan par pierre.

Le certificat imprimable ne dépend d'aucun fichier : il relit simplement
`product_gemstones` et imprime via `window.print()`, même mécanique que le
ticket de caisse. Les deux évoluent indépendamment — remplacer le scan
n'affecte pas le certificat imprimé, et vice-versa.

## Matériel : scanners et imprimantes

Contrainte du cahier des charges : **aucun pilote, aucun code périphérique dans
l'ERP**. Le même mémo est affiché dans Réglages → Caisses.

**Scanners.** Un lecteur de code-barres du commerce est un clavier HID : il *tape*
la référence puis Entrée. Rien à installer côté ERP — il suffit que le champ de
recherche du point de vente ait le focus. Une seule chose à configurer, sur le
lecteur lui-même avec les codes-barres de paramétrage du fabricant : **suffixe =
Entrée**. Les SKU (`MP-BAG-0412`) s'impriment en Code128. USB comme Bluetooth,
iPad compris. Le mode WebHID existe mais n'apporte rien ici et impose Chrome.

**RFID.** Les lecteurs de comptoir existent (EPC UHF pour lire un plateau entier,
13,56 MHz pour l'étiquette à l'unité) et la quasi-totalité se présente elle aussi
en clavier. Le point de vente n'a donc **rien** de spécifique à faire : il reçoit
un code et le résout. `private.resolve_product_code()` accepte indifféremment le
SKU ou l'EPC, sans distinction de casse — une pièce peut porter les deux, puce
pour l'inventaire tournant, code-barres pour l'étiquette prix. Le champ
« Scanner » d'une caisse est purement documentaire : il dit à l'équipe ce qui est
branché, il ne change aucun comportement.

**Imprimantes.** Une page web ne peut pas parler ESC/POS en direct à une imprimante
USB. Deux voies propres :

| Besoin | Support | Stratégie |
|---|---|---|
| Ticket de caisse | thermique 80 mm | HTML + `@page { size: 80mm auto }` + `window.print()` |
| Facture | A4 | PDF + dialogue d'impression |
| Étiquette bijou | Zebra / Brother | gabarit dédié, même principe |

1. **Impression navigateur** (retenue) — l'ERP produit le bon format, le pilote
   système fait le reste. Mac, Windows, iPad.
2. **Imprimante réseau qui tire ses travaux** (Star CloudPRNT, Epson Server Direct
   Print) — l'imprimante interroge une file exposée par l'ERP. À ajouter le jour où
   le matériel est acheté ; l'ERP reste sans pilote dans les deux cas.

`pos_terminals.printer_profile` mémorise le format par caisse ; le code
d'impression reste identique partout.

## Reste à faire

- Génération du PDF de facture (`@react-pdf/renderer`) et dépôt dans le bucket
  `invoices` ; `emitInvoice` gère déjà la numérotation et l'envoi.
- Vérifier le domaine d'envoi `maisonpiron.be` chez Resend — sans cela tout envoi
  échoue, même avec une clé valide.
- Renseigner `ADMIN_ALERT_EMAIL` pour recevoir les alertes d'échec de sync.
- Activer « Leaked Password Protection » (Supabase → Auth → Passwords) : signalé
  WARN par les advisors.
- Journaliser les échecs de connexion côté serveur, avec la clé service_role.
- Références à quantité multiple (chaînes au mètre, produits d'entretien) : le
  modèle actuel suppose une pièce unique par ligne `products`, ce qui couvre le
  catalogue bijouterie mais pas un article vendu en plusieurs exemplaires. Il
  faudrait alors une colonne de quantité et un compteur de réservations plutôt
  qu'un index unique.
- Balayage périodique des réservations expirées : aujourd'hui `release_expired_holds()`
  est appelée à chaque scan et à chaque encaissement, ce qui suffit tant qu'il y a
  du passage. Un Cron quotidien la rendrait indépendante de l'activité.
