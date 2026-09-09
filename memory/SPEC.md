# AIDONS-NOUS VIVANTS — spec

Plateforme de tontine. FastAPI + MongoDB / React 19 + Vite. Toutes les routes sous `/api`.

## Rôles
- **admin** : premier compte inscrit sur la plateforme. Possède "Ma gérance — Administrateur principal" + supervision globale.
- **manager** (gérant) : créé par l'admin via `POST /api/managers`. Sa propre gérance est créée automatiquement. Permissions configurables.
- **member** : tout compte créé via `/creer-mon-compte`.

Session = cookie httpOnly `anv_session` (JWT). `GET /api/auth/me`.

## Règle centrale
Une tontine = une gérance. `gerance_id` est copié sur tontine, position, demande, contrat, échéance, paiement, prise, notification. Un gérant ne voit que sa gérance (`assert_gerance_access`), l'admin voit tout.

## Collections
users, gerances, tontines, positions, membership_requests, tontine_members, contracts,
contribution_due_dates (source unique des échéances), payments, payouts, notifications,
notification_deliveries, identity_verifications, audit_logs.

## Flux principal
1. Inscription → session immédiate → onglet "Mon profil" (infos + pièce d'identité).
2. `/tontines-disponibles` → `/details-tontine?id=UUID` → "Adhérer à cette tontine" → `membership_requests` (pending) + notifications membre & responsable de la gérance.
3. Gérant/admin accepte → `tontine_members` + contrat (à signer) + génération des `contribution_due_dates` (1 ligne/jour).
4. Membre signe le contrat, sélectionne des jours dans "Mes cotisations", montant calculé serveur (jours × cotisation + pénalités 500 F/jour de retard), envoie la capture Wave (base64) → paiement `pending`, échéances `processing`.
5. Gérant/admin valide → échéances `paid`, notification "Paiement validé ✅". Rejet → échéances remises `pending`, notification "Paiement rejeté ⚠️".
6. Positions générées à la création de la tontine (dates = début + intervalle × n). Attribution manuelle, "Passer à la queue", puis "Confirmer la prise" → reçu de prise.

## Membres & invitations (espace gérant/admin, onglet « Membres & invitations »)
Deux façons d'ajouter un membre, toutes deux rattachables immédiatement à une tontine
(sans passer par une demande d'adhésion) :
- **Création directe** : `POST /api/members/create` (permission `manage_members`) — le responsable
  saisit un mot de passe provisoire. Si `tontine_id` est fourni → `enroll_member()`.
- **Invitation par lien** : `POST /api/invitations` (permission `invite_members`) → collection
  `invitations` (token unique, statut `sent` / `accepted` / `cancelled`).
  Page publique `/invitation?token=…` → `POST /api/invitations/token/{token}/accept` :
  le membre choisit lui-même son mot de passe, la session est ouverte immédiatement,
  et il est enrôlé dans la tontine de l'invitation.
- **Membre existant** : `POST /api/members/enrol` ajoute un compte déjà créé à une autre tontine.
- `enroll_member()` (lib/core.py) crée `tontine_members` + les `contribution_due_dates` + le contrat.

## Tontines déjà démarrées
Le calendrier complet est toujours généré depuis la date réelle de début (la tontine n'est jamais
redémarrée). Pour rattraper l'historique : `POST /api/due-dates/bulk-history`
(permission `record_history`) marque tous les jours d'un membre jusqu'à une date donnée
comme `paid` avec `source = "historique_gérant"` ou `"historique_administrateur"` —
jamais présenté comme un paiement Wave, et tracé dans `audit_logs` + notification au membre.

## Mise en page mobile (couleurs inchangées)
- `PublicLayout` (components/Shell.tsx) accepte `hasBottomBar` : ajoute le padding bas et masque
  le pied de page sur téléphone.
- En-tête : nav complète sur desktop ; sur téléphone, bouton « Créer » + menu latéral
  (`Sheet` côté droit, testid `mobile-menu-button`) contenant Mon espace, les pages publiques,
  Déconnexion et les pages légales.
- `scrollTabs` (exporté par Shell) : la `TabsList` défile horizontalement sur téléphone et se
  répartit en lignes sur desktop. `w-full max-w-full` est **obligatoire** — `TabsList` est
  `inline-flex`, sans cela elle se dimensionne sur son contenu et élargit tout le document
  (débordement horizontal de ~600 px).
- `BottomBar` (Shell) : barre de navigation basse, `md:hidden`, pilote l'onglet actif.
  Membre → Accueil / Cotisations / Tontines / Alertes (badge non lus).
  Gérant-admin → Accueil / Tontines / Membres / Paiements (badge à vérifier).
- Toasts en `bottom-center` avec `offset="5.5rem"` : en haut à droite ils recouvraient le bouton
  du menu mobile.
- Les lignes de listes (échéances, paiements, demandes) passent en blocs empilés sur téléphone
  (plus de largeurs fixes `w-24`/`w-40`), et les boutons d'action deviennent pleine largeur.

## Rappels quotidiens (cron plateforme)
`.emergent/crons.yml` → `rappel-echeances`, tous les jours à 07h00 `Africa/Abidjan`,
`POST /api/cron/daily-reminders` (routers/cron.py). Authentification
`Authorization: Bearer $WEBHOOK_CRON_SECRET` (backend/.env), idempotence sur `X-Webhook-Id`
(collection `cron_runs`), travail réel exécuté en tâche de fond. Une notification par membre,
par tontine et par jour (clé `dedupe_key` dans `notification_deliveries`) : montant du jour +
jours en retard et pénalités. Aucune duplication même si le cron est rejoué.

## Import Excel des membres
`POST /api/members/import` (permission `manage_members`) : fichier `.xlsx` (openpyxl) ou `.csv`
en base64, colonnes Prénom / Nom / Email / Téléphone (Email obligatoire). Un compte existant est
rattaché sans doublon, un nouveau compte est créé puis enrôlé (`enroll_member`). Le résultat
détaille chaque ligne : `created` / `enrolled` / `skipped` + motif. Audité.

## Aperçu de la preuve de paiement
`GET /api/payments/{id}/proof` reste privé (membre propriétaire, gérant de la gérance, admin).
Côté gérant/admin, bouton « Voir la preuve » → `Dialog` avec image zoomable (conteneur
`overflow-auto`, pinch-to-zoom sur téléphone) + « Ouvrir en plein écran ».

## Filtres des cotisations (espace gérant/admin)
Tous · À jour · En retard · Paiements à vérifier · Pénalités · Aujourd'hui · À venir —
filtrage client sur les lignes de `contribution_due_dates` déjà renvoyées par `/api/due-dates`.

## Routes frontend
`/`, `/tontines-disponibles`, `/details-tontine?id=`, `/comment-ca-marche`, `/regles`, `/a-propos`,
`/conditions-utilisation`, `/politique-confidentialite`, `/connexion`, `/creer-mon-compte`,
`/mot-de-passe-oublie`, `/invitation?token=`, `/espace-membre`, `/gerance`, `/administration`.

## Non livré en V1
Email / WhatsApp (in-app uniquement, mais `notification_deliveries` est déjà écrit).
Réinitialisation de mot de passe par email. Invitation gérant par email (mot de passe provisoire à la place).
