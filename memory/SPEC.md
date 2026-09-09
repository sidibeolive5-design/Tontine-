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

## Rappels planifiés (crons plateforme)
`.emergent/crons.yml` déclare deux tâches, toutes deux en `Africa/Abidjan` :
- `rappel-echeances-matin` — 07h00, `POST /api/cron/daily-reminders` (slot `morning`) :
  montant du jour + jours en retard et pénalités.
- `rappel-avant-heure-limite` — 16h00, `POST /api/cron/evening-reminders` (slot `evening`) :
  uniquement les membres dont la journée est encore impayée, avant l'heure limite de 18h00.

Les deux passent par `routers/cron.py` : authentification
`Authorization: Bearer $WEBHOOK_CRON_SECRET`, idempotence sur `X-Webhook-Id` + `job`
(collection `cron_runs`), accusé 2xx immédiat puis travail en tâche de fond, et
anti-duplication par `dedupe_key = reminder:{slot}:{member}:{tontine}:{jour}`
dans `notification_deliveries`.

## Tableau des retards (espace gérant/admin, onglet « Retards »)
`GET /api/arrears` (staff, cloisonné par gérance) : une ligne par membre × tontine ayant au moins
un jour en retard, triée par montant dû décroissant. Renvoie jours impayés, montant des
cotisations en retard, pénalités (jours de retard × pénalité de la tontine), total dû,
date du plus ancien impayé et progression. L'onglet affiche aussi 4 totaux :
membres en retard, total dû, dont pénalités, jours impayés.

## Règle des pénalités (corrigée)
Une pénalité **forfaitaire** de `penalty_per_day` (500 FCFA par défaut) s'applique **une seule fois
par jour impayé**, et seulement **à partir du lendemain** de l'échéance :
- échéance du 10 septembre → 0 FCFA le 10 (statut « À payer aujourd'hui »), 500 FCFA dès le 11 ;
- 5 jours impayés à 3 150 FCFA → 15 750 FCFA de cotisations + 2 500 FCFA de pénalités
  (référence spec §35). La pénalité **ne se cumule pas** jour après jour sur une même échéance.

Implémentation : `lib/core.py::penalty_amount(due, today, penalty_per_day)` — source unique
utilisée par `/api/due-dates`, `/api/summary`, `/api/arrears`, la soumission de paiement,
les statistiques de gérance et les deux crons. `late_days()` reste le nombre de jours écoulés
depuis l'échéance (affichage uniquement).

## Relance manuelle d'un membre en retard
`POST /api/arrears/remind` (permission `send_notifications`, cloisonné par gérance) : message
personnalisé optionnel + récapitulatif calculé côté serveur (jours impayés et total dû, pénalités
incluses), envoyé en notification « Relance de votre gérance » et audité.

## Export Excel des retards
`GET /api/arrears/export` (staff) : classeur `.xlsx` (openpyxl) `retards-AAAA-MM-JJ.xlsx` avec une
ligne par membre en retard, colonnes lisibles et ligne TOTAL. Renvoyé en base64, téléchargé côté
navigateur. Audité.

## Prises déjà versées (historique)
`POST /api/payouts/historical` (permission `record_history`) : enregistre une prise remise **avant
l'arrivée sur la plateforme** pour une position attribuée — date réelle, montant optionnel,
`source = historique_gérant` / `historique_administrateur`. Refuse un doublon sur la même position
(409) et une date mal formée (422). L'interface affiche « Historique enregistré par l'… » sur la
prise, pour ne jamais la confondre avec une confirmation du jour.

## Centre de paramètres (⚙️ Paramètres)
- `platform_settings` (doc unique `id="platform"`) : nom, slogan, logo (base64), WhatsApp, téléphone,
  email, adresse, devise, langue, contact. `GET /api/settings/platform` (lecture ouverte),
  `PUT` **réservé à l'administrateur** (403 pour un gérant).
- `finance_rules` (une par gérance) : heure limite, pénalité/jour, **jours de tolérance**,
  délai de remplacement, paiement anticipé + plafond, frais, remboursement.
  `GET/PUT /api/settings/finance` — un gérant est toujours épinglé à sa gérance.
  Chaque tontine peut surcharger `deadline_time`, `penalty_per_day`, `grace_days`, `penalty_mode`.
- Tout est lu en base avec valeurs par défaut de repli : les tontines créées avant le centre de
  paramètres continuent de fonctionner sans migration.

## Moyens de paiement (par gérance, puis par tontine)
`payment_methods` : {gerance_id, name, code, number, holder, icon, active, instructions, sort_order}.
CRUD `/api/payment-methods/manage` (+ `PATCH`/`DELETE` cloisonnés). Sélection par tontine via
`PUT /api/tontines/{id}/payment-methods` ; le membre lit
`GET /api/tontines/{id}/payment-options` (actifs de la gérance ∩ sélection de la tontine ;
aucune sélection = tous les actifs). Si aucune méthode n'est configurée, repli sur l'entrée Wave
historique. Le paiement stocke un **instantané** `method_name` / `method_number` : supprimer ou
renommer un moyen ne réécrit jamais l'historique. Un moyen désactivé est refusé (400) pour un
nouveau paiement.

## Branches (parts) — multi-tontines et multi-parts
- Un compte = plusieurs adhésions indépendantes ; chaque adhésion porte un nombre de **branches**.
- Tontine : `allow_multi_branch`, `max_branches_per_member`, `total_branches` (capacité comptée en
  branches, défaut = `member_count`), `penalty_mode` (`member` | `branch`), `turn_mode`
  (`manual` | `auto`).
- `membership_requests.branches` → le gérant voit « 2 branches · 2 200 FCFA/jour » avant d'accepter.
- `assert_branches_available()` bloque : plusieurs branches sur une tontine mono (422), dépassement
  du maximum par membre (422), capacité insuffisante (409). Re-contrôlée **à l'acceptation**.
- `generate_due_dates(tontine, member, branches)` : `amount = daily_amount × branches`, et la ligne
  garde `branches` pour le mode de pénalité « par branche ». Les documents antérieurs sans
  `branches` comptent pour 1 part — aucune migration nécessaire.

## Modifier une tontine déjà créée (admin ET gérants)
Bouton « Modifier la tontine » sur chaque `TontineCard` (espaces `/administration` et `/gerance`,
testid `tontine-edit-button-{id}`) → `EditTontineDialog`.
- `PATCH /api/tontines/{id}` (permission `edit_tontine`, cloisonné par gérance) accepte désormais :
  nom, description, statut, date de début, heure limite, cotisation quotidienne, montant bénéficiaire,
  intervalle, nombre de bénéficiaires, durée, nombre de membres, pénalité/jour, jours de tolérance,
  branches (total / multi / max), `penalty_mode`, `turn_mode`, `is_existing`. `end_date` est recalculé.
- Champs **structurels** (`start_date`, `interval_days`, `duration_days`, `beneficiary_count`,
  `daily_amount`, `deadline_time`) → écran de confirmation obligatoire alimenté par
  `GET /api/tontines/{id}/edit-impact?…` : **anciennes dates** vs **nouvelles dates** de prise,
  durée avant/après, prises déjà versées et jours verrouillés (spec §34).
- À l'enregistrement, `_resync_positions()` réécrit les dates de prise (une position `received`
  n'est jamais modifiée ni supprimée) et `_resync_due_dates()` réaligne le calendrier de chaque
  membre : ajout des jours manquants, suppression des jours `pending` hors calendrier, remise à
  jour du montant (`daily_amount × branches`) et de l'heure limite. Les jours `paid` / `processing`
  sont **protégés** (jamais supprimés, jamais re-tarifés) ; les périodes sont renumérotées.
- Refus 409 si la capacité en branches descend sous les branches déjà attribuées ; 422 sur date,
  statut, mode ou valeur invalide. Chaque modification est auditée (`tontine_updated`, avec l'impact)
  et notifie tous les membres actifs de la tontine.

## Reçu de paiement
À la validation, `receipt_number = ANV-<année>-<séquence par gérance>` est attribué et affiché
côté membre et côté gérant, avec le moyen de paiement, la référence saisie et le montant.

## Routes frontend
`/`, `/tontines-disponibles`, `/details-tontine?id=`, `/comment-ca-marche`, `/regles`, `/a-propos`,
`/conditions-utilisation`, `/politique-confidentialite`, `/connexion`, `/creer-mon-compte`,
`/mot-de-passe-oublie`, `/invitation?token=`, `/espace-membre`, `/gerance`, `/administration`.

## Non livré en V1
Email / WhatsApp (in-app uniquement, mais `notification_deliveries` est déjà écrit).
Réinitialisation de mot de passe par email. Invitation gérant par email (mot de passe provisoire à la place).
