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

## Routes frontend
`/`, `/tontines-disponibles`, `/details-tontine?id=`, `/comment-ca-marche`, `/regles`, `/a-propos`,
`/conditions-utilisation`, `/politique-confidentialite`, `/connexion`, `/creer-mon-compte`,
`/mot-de-passe-oublie`, `/espace-membre`, `/gerance`, `/administration`.

## Non livré en V1
Email / WhatsApp (in-app uniquement, mais `notification_deliveries` est déjà écrit).
Réinitialisation de mot de passe par email. Invitation gérant par email (mot de passe provisoire à la place).
