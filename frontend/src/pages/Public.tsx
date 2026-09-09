import { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PublicLayout, StatusPill, Empty } from "@/components/Shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useMe } from "@/lib/session";
import { fcfa, type MemberMethod, type Position, type Tontine } from "@/lib/types";

export function AvailableTontines() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["tontines", "public"],
    queryFn: () => apiGet<Tontine[]>("/tontines/public"),
    retry: false,
  });
  const rows = isError ? [] : data ?? [];

  return (
    <PublicLayout>
      <div className="mx-auto w-full max-w-6xl px-4 py-10 md:px-5 md:py-14">
        <h1 className="font-heading text-3xl md:text-4xl">Tontines disponibles</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
          Chaque tontine appartient à une gérance unique. Consultez la formule avant d'envoyer votre demande d'adhésion.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="available-tontines-grid">
          {isLoading && <Empty text="Chargement des tontines…" />}
          {!isLoading && rows.length === 0 && (
            <div className="md:col-span-2 lg:col-span-3">
              <Empty text="Aucune tontine ouverte pour le moment." testId="available-tontines-empty" />
            </div>
          )}
          {rows.map((t) => (
            <div key={t.id} className="flex flex-col rounded-2xl border border-border/70 bg-card p-5 transition-transform duration-300 hover:-translate-y-1">
              <div className="flex items-start justify-between gap-3">
                <p className="font-heading text-xl">{t.name}</p>
                <StatusPill value={t.status} />
              </div>
              <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{t.gerance_name}</p>
              <dl className="mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Cotisation</dt><dd>{fcfa(t.daily_amount)} / jour</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Prise</dt><dd>{fcfa(t.payout_amount)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Membres</dt><dd>{t.joined_count}/{t.member_count}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Durée</dt><dd>{t.duration_days} jours</dd></div>
              </dl>
              <Link
                to={`/details-tontine?id=${t.id}`}
                className={buttonVariants({ className: "mt-5 w-full" })}
                data-testid={`tontine-detail-link-${t.id}`}
              >
                Voir le détail
              </Link>
            </div>
          ))}
        </div>
      </div>
    </PublicLayout>
  );
}

export function TontineDetail() {
  const [params] = useSearchParams();
  const id = params.get("id") ?? "";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [branches, setBranches] = useState(1);

  const tontine = useQuery({
    queryKey: ["tontine", id],
    queryFn: () => apiGet<Tontine>(`/tontines/${id}`),
    enabled: Boolean(id),
    retry: false,
  });
  const positions = useQuery({
    queryKey: ["tontine", id, "positions"],
    queryFn: () => apiGet<Position[]>(`/tontines/${id}/positions`),
    enabled: Boolean(id),
    retry: false,
  });
  const options = useQuery({
    queryKey: ["tontine", id, "payment-options"],
    queryFn: () => apiGet<MemberMethod[]>(`/tontines/${id}/payment-options`),
    enabled: Boolean(id),
    retry: false,
  });

  const join = useMutation({
    mutationFn: () => apiPost("/memberships/request", { tontine_id: id, branches }),
    onSuccess: () => {
      toast.success("Votre demande d'adhésion a bien été enregistrée ✅");
      qc.invalidateQueries({ queryKey: ["memberships"] });
      navigate("/espace-membre");
    },
    onError: (e) => {
      const detail = e instanceof ApiError ? (e.body as { detail?: string } | null)?.detail : null;
      toast.error(detail ?? "Impossible d'enregistrer la demande");
    },
  });

  const t = tontine.data;
  const maxBranches = t?.allow_multi_branch
    ? Math.max(1, Math.min(t.max_branches_per_member, t.branches_available || t.max_branches_per_member))
    : 1;

  return (
    <PublicLayout>
      <div className="mx-auto w-full max-w-5xl px-4 py-10 md:px-5 md:py-14">
        {tontine.isLoading && <Empty text="Chargement de la tontine…" />}
        {!tontine.isLoading && !t && (
          <div data-testid="tontine-not-found">
            <h1 className="font-heading text-4xl">Tontine introuvable</h1>
            <p className="mt-2 text-muted-foreground">Cette tontine n'existe pas ou n'est plus disponible.</p>
            <Link to="/tontines-disponibles" className={buttonVariants({ className: "mt-6" })}>
              Voir les tontines disponibles
            </Link>
          </div>
        )}
        {t && (
          <>
            <p className="text-xs uppercase tracking-[0.2em] text-primary">{t.gerance_name}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="font-heading text-3xl md:text-4xl" data-testid="tontine-detail-name">{t.name}</h1>
              <StatusPill value={t.status} testId="tontine-detail-status" />
            </div>
            <p className="mt-3 max-w-2xl text-muted-foreground">{t.description || "Aucune description fournie."}</p>

            <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {[
                ["Cotisation quotidienne", `${fcfa(t.daily_amount)}`],
                ["Montant bénéficiaire", fcfa(t.payout_amount)],
                ["Intervalle entre prises", `${t.interval_days} jours`],
                ["Bénéficiaires", `${t.beneficiary_count}`],
                ["Membres", `${t.joined_count}/${t.member_count}`],
                ["Branches disponibles", `${t.branches_available}/${t.total_branches ?? t.member_count}`],
                ["Branches par membre", t.allow_multi_branch ? `jusqu'à ${t.max_branches_per_member}` : "1 seule"],
                ["Pénalité", t.penalty_mode === "branch" ? "par branche" : "par membre"],
                ["Durée", `${t.duration_days} jours`],
                ["Début", t.start_date],
                ["Fin", t.end_date],
                ["Heure limite", t.deadline_time],
                ["Pénalité de retard", `${fcfa(t.penalty_per_day)} / jour`],
                ["Fuseau horaire", t.timezone],
                ["Gérance", t.gerance_name],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl border border-border/70 bg-card p-4">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">{k}</p>
                  <p className="mt-1 font-medium">{v}</p>
                </div>
              ))}
            </div>

            <div className="mt-10">
              <h2 className="font-heading text-2xl">Positions et dates de prise</h2>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="tontine-positions-list">
                {(positions.data ?? []).map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-xl border border-border/70 bg-card px-4 py-3 text-sm">
                    <span className="font-medium">Position {p.index}</span>
                    <span className="text-muted-foreground">{p.payout_date}</span>
                    <span className="text-xs text-primary">{p.member_name ?? "Libre"}</span>
                  </div>
                ))}
                {(positions.data ?? []).length === 0 && (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Empty text="Les positions ne sont pas encore publiées." />
                  </div>
                )}
              </div>
            </div>

            <div className="mt-10 rounded-2xl border border-primary/25 bg-primary/5 p-5 md:p-6">
              {(options.data ?? []).length > 0 && (
                <div className="mb-5">
                  <p className="text-sm font-medium">Moyens de paiement acceptés pour cette tontine</p>
                  <div className="mt-2 flex flex-wrap gap-2" data-testid="tontine-payment-options">
                    {(options.data ?? []).map((m) => (
                      <span key={m.id} className="rounded-xl border border-border/70 bg-card px-3 py-1.5 text-sm">
                        {m.icon} {m.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {me ? (
                <>
                  {t.allow_multi_branch && (
                    <div className="mb-4" data-testid="branch-selector">
                      <p className="text-sm font-medium">Choisissez le nombre de branches</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {Array.from({ length: maxBranches }, (_, i) => i + 1).map((n) => (
                          <Button
                            key={n}
                            size="sm"
                            variant={branches === n ? "default" : "outline"}
                            onClick={() => setBranches(n)}
                            data-testid={`branch-option-${n}`}
                          >
                            {n} branche{n > 1 ? "s" : ""}
                          </Button>
                        ))}
                      </div>
                      <div className="mt-3 space-y-1 rounded-xl bg-card p-3 text-sm">
                        <p>Nombre de branches : <strong>{branches}</strong></p>
                        <p>Cotisation par branche : <strong>{fcfa(t.daily_amount)}</strong> / jour</p>
                        <p>
                          Votre cotisation totale :{" "}
                          <strong className="text-primary" data-testid="branch-total-daily">
                            {fcfa(t.daily_amount * branches)}
                          </strong>{" "}
                          / jour
                        </p>
                        <p className="text-muted-foreground">
                          Branches disponibles : {t.branches_available} / {t.total_branches ?? t.member_count} ·
                          maximum {t.max_branches_per_member} par membre
                        </p>
                      </div>
                    </div>
                  )}
                  <Button
                    size="lg"
                    className="w-full sm:w-auto"
                    onClick={() => join.mutate()}
                    disabled={join.isPending || t.branches_available === 0}
                    data-testid="join-tontine-button"
                  >
                    {join.isPending
                      ? "Envoi…"
                      : t.branches_available === 0
                        ? "Plus de place disponible"
                        : t.allow_multi_branch
                          ? `Confirmer ma demande (${branches} branche${branches > 1 ? "s" : ""})`
                          : "Adhérer à cette tontine"}
                  </Button>
                </>
              ) : (
                <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                  <p className="text-sm text-muted-foreground">Créez votre compte pour envoyer une demande d'adhésion.</p>
                  <Link to="/creer-mon-compte" className={buttonVariants({ className: "shrink-0" })} data-testid="detail-register-link">
                    Créer mon compte
                  </Link>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </PublicLayout>
  );
}

const CONTENT: Record<string, { title: string; blocks: [string, string][] }> = {
  "comment-ca-marche": {
    title: "Comment ça marche",
    blocks: [
      ["1. Créez votre compte", "Inscription gratuite, puis vous complétez vos informations personnelles et votre pièce d'identité."],
      ["2. Choisissez une tontine", "Chaque tontine affiche sa cotisation quotidienne, sa prise, son intervalle et sa durée."],
      ["3. Demandez votre adhésion", "Le responsable de la gérance concernée reçoit et traite votre demande."],
      ["4. Signez votre contrat", "Une fois accepté, votre contrat est généré avec votre position et votre date de prise."],
      ["5. Cotisez et payez par Wave", "Vous sélectionnez les jours à régler, le montant est calculé automatiquement, vous envoyez la capture Wave."],
      ["6. Recevez votre prise", "À votre date de position, le responsable confirme la remise et votre reçu est généré."],
    ],
  },
  regles: {
    title: "Règles de la plateforme",
    blocks: [
      ["Une tontine = une gérance", "Une tontine appartient à une seule gérance. Les données ne sont jamais fusionnées entre gérances."],
      ["Heure limite quotidienne", "Chaque échéance a une heure limite. Passée cette heure, le jour est compté en retard."],
      ["Pénalités", "Par défaut 500 FCFA par jour de retard, ajoutés automatiquement au montant à payer."],
      ["Preuve obligatoire", "Aucun paiement n'est validé sans preuve vérifiée par un responsable autorisé."],
      ["Une position par membre", "Un membre ne peut pas occuper deux positions dans la même tontine."],
      ["Reçu après confirmation réelle", "Le reçu de prise n'est généré qu'après confirmation de la remise effective."],
    ],
  },
  "a-propos": {
    title: "À propos",
    blocks: [
      ["AIDONS-NOUS VIVANTS", "Une plateforme de tontine pensée pour l'entraide organisée : chaque franc cotisé est traçable, chaque prise vérifiée."],
      ["Notre engagement", "Pas de fausses données, pas de paiement simulé. Ce que vous voyez reflète l'état réel de vos cotisations."],
      ["Contact", "Passez par les notifications de votre espace ou contactez le responsable de votre gérance."],
    ],
  },
  "conditions-utilisation": {
    title: "Conditions d'utilisation",
    blocks: [
      ["Objet", "Ces conditions encadrent l'utilisation de la plateforme AIDONS-NOUS VIVANTS."],
      ["Compte", "Vous vous engagez à fournir des informations exactes et à protéger vos identifiants."],
      ["Cotisations", "Le membre s'engage à respecter le calendrier de cotisation de la tontine à laquelle il adhère."],
      ["Pénalités", "Tout retard de cotisation entraîne une pénalité selon le barème affiché dans la tontine."],
      ["Résiliation", "Un compte peut être suspendu en cas de manquement grave aux règles de la plateforme."],
    ],
  },
  "politique-confidentialite": {
    title: "Politique de confidentialité",
    blocks: [
      ["Données collectées", "Identité, coordonnées, pièce justificative et historique de cotisation."],
      ["Usage", "Ces données servent uniquement au fonctionnement de vos tontines et à la vérification des paiements."],
      ["Accès", "Vos documents d'identité et vos preuves de paiement restent privés : seuls les responsables autorisés y accèdent."],
      ["Conservation", "Les historiques sont conservés pour assurer la traçabilité des opérations."],
    ],
  },
};

export function InfoPage({ slug }: { slug: string }) {
  const page = CONTENT[slug];
  return (
    <PublicLayout>
      <div className="mx-auto w-full max-w-3xl px-4 py-10 md:px-5 md:py-14">
        <h1 className="font-heading text-3xl md:text-4xl" data-testid="info-page-title">{page?.title ?? "Page"}</h1>
        <div className="mt-6 space-y-4 md:mt-8 md:space-y-6">
          {(page?.blocks ?? []).map(([h, p]) => (
            <div key={h} className="rounded-2xl border border-border/70 bg-card p-5 md:p-6">
              <h2 className="font-heading text-xl">{h}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{p}</p>
            </div>
          ))}
        </div>
      </div>
    </PublicLayout>
  );
}
