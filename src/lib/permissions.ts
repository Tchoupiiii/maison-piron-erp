/**
 * Clés de permission, miroir de `permission_catalogue`.
 * La base reste la référence : ce fichier ne sert qu'au typage et à l'affichage.
 */
export const PERMISSIONS = {
  inventaireVoir: "inventaire.voir",
  inventaireCreer: "inventaire.creer",
  inventaireModifier: "inventaire.modifier",
  inventaireStatut: "inventaire.statut",
  inventairePrix: "inventaire.prix",
  inventaireSupprimer: "inventaire.supprimer",
  atelierVoir: "atelier.voir",
  atelierCreer: "atelier.creer",
  atelierModifier: "atelier.modifier",
  atelierStatut: "atelier.statut",
  atelierSupprimer: "atelier.supprimer",
  clienteleVoir: "clientele.voir",
  clienteleCreer: "clientele.creer",
  clienteleModifier: "clientele.modifier",
  clienteleRgpd: "clientele.rgpd",
  clienteleSupprimer: "clientele.supprimer",
  ventesVoir: "ventes.voir",
  ventesCreer: "ventes.creer",
  ventesFacturer: "ventes.facturer",
  ventesPaiement: "ventes.paiement",
  ventesRemise: "ventes.remise",
  ventesRetour: "ventes.retour",
  metauxVoir: "metaux.voir",
  metauxSync: "metaux.sync",
  metauxRecalculer: "metaux.recalculer",
  systemeEmployes: "systeme.employes",
  systemePermissions: "systeme.permissions",
  systemeJournal: "systeme.journal",
  systemeCaisses: "systeme.caisses",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Ordre d'affichage des catégories dans l'écran Réglages. */
export const PERMISSION_CATEGORIES = [
  "Inventaire",
  "Atelier",
  "Clientèle",
  "Ventes",
  "Métaux",
  "Système",
] as const;

export const STAFF_ROLE_LABELS = {
  admin: "Administrateur",
  gemmologue: "Gemmologue",
  vendeuse: "Vendeur·euse",
} as const;

export const ACTIVITY_LABELS: Record<string, string> = {
  connexion: "Connexion",
  deconnexion: "Déconnexion",
  produit_cree: "Pièce créée",
  produit_modifie: "Pièce modifiée",
  produit_statut: "Statut de pièce",
  produit_supprime: "Pièce supprimée",
  prix_modifie: "Prix modifié",
  prix_recalcule: "Prix recalculé",
  ticket_cree: "Ticket créé",
  ticket_statut: "Ticket avancé",
  client_cree: "Client créé",
  client_modifie: "Client modifié",
  client_supprime: "Client supprimé",
  client_anonymise: "Client anonymisé",
  client_exporte: "Données exportées",
  vente_creee: "Vente encaissée",
  facture_emise: "Facture émise",
  paiement_enregistre: "Paiement enregistré",
  employe_cree: "Employé créé",
  employe_modifie: "Employé modifié",
  employe_desactive: "Employé désactivé",
  employe_supprime: "Employé supprimé",
  session_revoquee: "Session révoquée",
  permission_modifiee: "Permission modifiée",
  caisse_creee: "Caisse créée",
  caisse_modifiee: "Caisse modifiée",
  maison_modifiee: "Identité de la maison modifiée",
  sync_metaux: "Synchronisation des cours",
};

/**
 * Une entrée de navigation n'apparaît que si l'employé a l'une des permissions
 * requises (`null` = toujours visible).
 */
export const NAV_ITEMS: readonly {
  href: string;
  label: string;
  permission: PermissionKey | readonly PermissionKey[] | null;
}[] = [
  { href: "/dashboard", label: "Tableau de bord", permission: null },
  { href: "/inventaire", label: "Inventaire", permission: PERMISSIONS.inventaireVoir },
  { href: "/atelier", label: "Atelier", permission: PERMISSIONS.atelierVoir },
  { href: "/clientele", label: "Clientèle", permission: PERMISSIONS.clienteleVoir },
  { href: "/ventes", label: "Ventes & factures", permission: PERMISSIONS.ventesVoir },
  { href: "/cours-metaux", label: "Cours des métaux", permission: PERMISSIONS.metauxVoir },
  // Le point de vente est une application séparée (même base, mêmes comptes) :
  // l'entrée disparaît du menu si son URL n'est pas configurée.
  {
    href: process.env.NEXT_PUBLIC_POS_URL ?? "",
    label: "Point de vente",
    permission: PERMISSIONS.ventesCreer,
  },
  {
    href: "/reglages",
    label: "Réglages",
    // La page accepte l'un OU l'autre : le menu doit refléter la même règle.
    permission: [PERMISSIONS.systemeEmployes, PERMISSIONS.systemeJournal],
  },
] as const;

/**
 * Regroupement de l'écran Réglages > Permissions « par page » : la ligne
 * `viewKey` (accès à la page) s'affiche en premier, les actions du domaine
 * dessous. Dérivé de la convention `<domaine>.<action>` du catalogue —
 * aucune colonne SQL supplémentaire.
 */
export const PERMISSION_PAGES: readonly {
  title: string;
  /** Clé « accès à la page » ; null = pas de ligne d'accès (cas Réglages). */
  viewKey: string | null;
  prefix?: string;
  only?: readonly string[];
  exclude?: readonly string[];
  note?: string;
}[] = [
  { title: "Inventaire", viewKey: PERMISSIONS.inventaireVoir, prefix: "inventaire." },
  { title: "Atelier", viewKey: PERMISSIONS.atelierVoir, prefix: "atelier." },
  { title: "Clientèle", viewKey: PERMISSIONS.clienteleVoir, prefix: "clientele." },
  {
    title: "Ventes & factures",
    viewKey: PERMISSIONS.ventesVoir,
    prefix: "ventes.",
    exclude: [PERMISSIONS.ventesCreer],
  },
  {
    title: "Point de vente",
    viewKey: PERMISSIONS.ventesCreer,
    only: [PERMISSIONS.ventesCreer],
    note: "Ce droit ouvre la caisse : encaisser une vente, scanner, réserver.",
  },
  { title: "Cours des métaux", viewKey: PERMISSIONS.metauxVoir, prefix: "metaux." },
  {
    title: "Réglages (Système)",
    viewKey: null,
    prefix: "systeme.",
    note: "L'accès à la page Réglages est ouvert par « Gérer les employés » ou « Consulter le journal ».",
  },
] as const;
