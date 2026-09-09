import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PublicLayout, Stat, StatusPill, Empty, BottomBar, scrollTabs } from "@/components/Shell";
import { LayoutDashboard, CalendarClock, Users, Bell } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { useMe } from "@/lib/session";
import {
  fcfa,
  label,
  type Contract,
  type DueDate,
  type MemberMethod,
  type MembershipRequest,
  type MyTontine,
  type Notification,
  type Payment,
  type PaymentMethodsResponse,
  type Payout,
  type Summary,
  type User,
} from "@/lib/types";

const detail = (e: unknown, fallback: string) =>
  (e instanceof ApiError ? (e.body as { detail?: string } | null)?.detail : null) ?? fallback;

function ProfileForm({ me }: { me: User }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    first_name: me.first_name,
    last_name: me.last_name,
    phone: me.phone,
    address: me.address ?? "",
    extra_info: me.extra_info ?? "",
  });
  const [idDoc, setIdDoc] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => apiPatch<User>("/auth/profile", { ...form, id_document: idDoc ?? undefined }),
    onSuccess: () => {
      toast.success("Informations enregistrées");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Enregistrement impossible")),
  });

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="p-first">Prénom</Label>
        <Input id="p-first" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} data-testid="profile-firstname-input" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="p-last">Nom</Label>
        <Input id="p-last" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} data-testid="profile-lastname-input" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="p-phone">Téléphone</Label>
        <Input id="p-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="profile-phone-input" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="p-address">Adresse</Label>
        <Input id="p-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="profile-address-input" />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="p-extra">Informations supplémentaires</Label>
        <Textarea id="p-extra" value={form.extra_info} onChange={(e) => setForm({ ...form, extra_info: e.target.value })} data-testid="profile-extra-input" />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="p-id">Pièce d'identité (photo)</Label>
        <Input
          id="p-id"
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          data-testid="profile-identity-input"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => setIdDoc(String(reader.result));
            reader.readAsDataURL(file);
          }}
        />
        <p className="text-xs text-muted-foreground">
          Statut d'identité : {label(me.identity_status)}. Vos documents restent privés.
        </p>
      </div>
      <Button type="submit" className="sm:col-span-2" disabled={save.isPending} data-testid="profile-save-button">
        {save.isPending ? "Enregistrement…" : "Enregistrer mes informations"}
      </Button>
    </form>
  );
}

function PayDialogSection({ dues, methods }: { dues: DueDate[]; methods?: PaymentMethodsResponse }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [proof, setProof] = useState<{ data: string; name: string } | null>(null);
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");

  const payable = dues.filter((d) => d.status === "pending");
  const chosen = payable.filter((d) => selected.includes(d.id));
  const total = chosen.reduce((s, d) => s + d.amount + d.penalty, 0);
  const tontineId = chosen[0]?.tontine_id;

  const options = useQuery({
    queryKey: ["tontine", tontineId, "payment-options"],
    queryFn: () => apiGet<MemberMethod[]>(`/tontines/${tontineId}/payment-options`),
    enabled: Boolean(tontineId),
    retry: false,
  });
  const geranceMethods = options.data ?? [];
  const activeMethod = geranceMethods.find((m) => m.code === method) ?? geranceMethods[0];

  const submit = useMutation({
    mutationFn: () =>
      apiPost<Payment>("/payments", {
        tontine_id: tontineId,
        due_date_ids: selected,
        method: activeMethod?.code ?? "wave",
        proof_image: proof?.data,
        proof_filename: proof?.name,
        reference: reference.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Preuve envoyée — en attente de vérification");
      setSelected([]);
      setProof(null);
      setReference("");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Envoi impossible")),
  });

  const multiTontine = new Set(chosen.map((d) => d.tontine_id)).size > 1;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
      <div className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
        <h3 className="font-heading text-xl">Calendrier des échéances</h3>
        <div className="mt-4 max-h-[22rem] space-y-2 overflow-y-auto pr-1 md:max-h-[26rem]" data-testid="due-dates-list">
          {dues.length === 0 && <Empty text="Aucune échéance : adhérez à une tontine pour démarrer." testId="due-dates-empty" />}
          {dues.map((d) => (
            <label
              key={d.id}
              className="flex items-start gap-3 rounded-xl border border-border/60 px-3 py-2.5 text-sm transition-colors duration-200 active:bg-accent/40"
              data-testid={`due-row-${d.id}`}
            >
              {d.status === "pending" ? (
                <Checkbox
                  className="mt-0.5 shrink-0"
                  checked={selected.includes(d.id)}
                  onCheckedChange={(v) => setSelected((s) => (v ? [...s, d.id] : s.filter((x) => x !== d.id)))}
                  data-testid={`due-checkbox-${d.id}`}
                />
              ) : (
                <span className="mt-0.5 inline-block size-4 shrink-0" />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{d.date}</span>
                  <span>{fcfa(d.amount)}</span>
                  <span className="text-muted-foreground">avant {d.deadline_time}</span>
                  <StatusPill value={d.display_status} />
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="truncate">{d.tontine_name}</span>
                  {d.penalty > 0 && <span className="text-red-700">+{fcfa(d.penalty)} pénalité</span>}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:p-5">
        <h3 className="font-heading text-xl">Payer mes jours</h3>
        <p className="mt-1 text-sm text-muted-foreground">Le montant est calculé automatiquement.</p>
        <div className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between"><span>Jours sélectionnés</span><span data-testid="pay-selected-count">{chosen.length}</span></div>
          <div className="flex justify-between"><span>Cotisations</span><span>{fcfa(chosen.reduce((s, d) => s + d.amount, 0))}</span></div>
          <div className="flex justify-between"><span>Pénalités</span><span>{fcfa(chosen.reduce((s, d) => s + d.penalty, 0))}</span></div>
          <div className="mt-2 flex justify-between border-t border-primary/20 pt-2 font-heading text-lg">
            <span>Total</span>
            <span data-testid="pay-total-amount">{fcfa(total)}</span>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          {geranceMethods.length > 0 ? (
            geranceMethods.map((m) => {
              const chosenMethod = (activeMethod?.code ?? "") === m.code;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.code)}
                  className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors duration-200 ${chosenMethod ? "border-primary bg-card" : "border-border/60 bg-card/60"}`}
                  data-testid={`payment-method-${m.code}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span>{m.icon} {m.name}</span>
                    {chosenMethod && <span className="text-xs text-primary">Sélectionné</span>}
                  </span>
                  {chosenMethod && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {m.number ? `Numéro : ${m.number}` : "Numéro non renseigné"}
                      {m.holder ? ` · ${m.holder}` : ""}
                      {m.instructions ? ` — ${m.instructions}` : ""}
                    </span>
                  )}
                </button>
              );
            })
          ) : (
            (methods?.methods ?? []).map((m) => (
              <div
                key={m.code}
                className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${m.available ? "border-primary/40 bg-card" : "border-border/60 opacity-60"}`}
                data-testid={`payment-method-${m.code}`}
              >
                <span>{m.emoji} {m.label}</span>
                <span className="text-xs">{m.available ? "Disponible" : "Bientôt disponible"}</span>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 rounded-xl bg-card p-3 text-sm">
          <p className="text-muted-foreground">Numéro à créditer</p>
          <p className="font-medium" data-testid="wave-number">
            {activeMethod?.number || methods?.wave_number || "—"}
          </p>
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="pay-ref">Référence de la transaction (optionnel)</Label>
          <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} data-testid="payment-reference-input" />
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="proof">Capture du paiement Wave</Label>
          <Input
            id="proof"
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            capture={undefined}
            data-testid="payment-proof-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setProof({ data: String(reader.result), name: file.name });
              reader.readAsDataURL(file);
            }}
          />
          {proof && (
            <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-2">
              <img src={proof.data} alt="aperçu" className="size-14 rounded-lg object-cover" data-testid="payment-proof-preview" />
              <span className="flex-1 truncate text-xs">{proof.name}</span>
              <Button size="xs" variant="ghost" onClick={() => setProof(null)} data-testid="payment-proof-remove">
                Supprimer
              </Button>
            </div>
          )}
        </div>

        <Button
          className="mt-4 w-full"
          disabled={submit.isPending || chosen.length === 0 || !proof || multiTontine}
          onClick={() => submit.mutate()}
          data-testid="payment-submit-button"
        >
          {submit.isPending ? "Envoi…" : "Envoyer ma preuve"}
        </Button>
        {multiTontine && <p className="mt-2 text-xs text-red-700">Sélectionnez des jours d'une seule tontine à la fois.</p>}
      </div>
    </div>
  );
}

export default function MemberSpace() {
  const [params] = useSearchParams();
  const { data: me, isLoading } = useMe();
  const qc = useQueryClient();
  const [tab, setTab] = useState(params.get("onboarding") ? "profil" : "dashboard");

  const summaries = useQuery({ queryKey: ["summary"], queryFn: () => apiGet<Summary[]>("/summary"), retry: false });
  const dues = useQuery({ queryKey: ["due-dates"], queryFn: () => apiGet<DueDate[]>("/due-dates"), retry: false });
  const mine = useQuery({ queryKey: ["memberships", "mine"], queryFn: () => apiGet<MyTontine[]>("/memberships/mine"), retry: false });
  const requests = useQuery({ queryKey: ["memberships", "requests"], queryFn: () => apiGet<MembershipRequest[]>("/memberships/requests"), retry: false });
  const contracts = useQuery({ queryKey: ["contracts"], queryFn: () => apiGet<Contract[]>("/contracts"), retry: false });
  const payments = useQuery({ queryKey: ["payments"], queryFn: () => apiGet<Payment[]>("/payments"), retry: false });
  const payouts = useQuery({ queryKey: ["payouts"], queryFn: () => apiGet<Payout[]>("/payouts"), retry: false });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => apiGet<Notification[]>("/notifications"), retry: false });
  const methods = useQuery({ queryKey: ["payment-methods"], queryFn: () => apiGet<PaymentMethodsResponse>("/payment-methods"), retry: false });

  const sign = useMutation({
    mutationFn: (id: string) => apiPost<Contract>(`/contracts/${id}/sign`),
    onSuccess: () => {
      toast.success("Contrat signé");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Signature impossible")),
  });

  const totals = useMemo(() => {
    const list = summaries.data ?? [];
    return {
      paid: list.reduce((s, x) => s + x.total_paid, 0),
      remaining: list.reduce((s, x) => s + x.total_remaining, 0),
      penalties: list.reduce((s, x) => s + x.penalties, 0),
      late: list.reduce((s, x) => s + x.late_days_count, 0),
    };
  }, [summaries.data]);

  if (!isLoading && !me) {
    return (
      <PublicLayout>
        <div className="mx-auto max-w-md px-5 py-20 text-center">
          <h1 className="font-heading text-3xl">Connexion requise</h1>
          <p className="mt-2 text-muted-foreground">Connectez-vous pour accéder à votre espace membre.</p>
          <Link to="/connexion" className={buttonVariants({ className: "mt-6" })} data-testid="member-login-redirect">Se connecter</Link>
        </div>
      </PublicLayout>
    );
  }

  const unread = (notifications.data ?? []).filter((n) => !n.read).length;

  return (
    <PublicLayout hasBottomBar>
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-5 md:py-10">
        <h1 className="font-heading text-3xl md:text-4xl" data-testid="member-space-title">Mon espace</h1>
        <p className="mt-1 text-sm text-muted-foreground md:text-base">
          {me ? `${me.first_name} ${me.last_name}` : "…"} — AIDONS-NOUS VIVANTS
        </p>

        <Tabs value={tab} onValueChange={setTab} className="mt-6 min-w-0 md:mt-8">
          <TabsList variant="line" className={scrollTabs}>
            <TabsTrigger value="dashboard" data-testid="tab-dashboard">Tableau de bord</TabsTrigger>
            <TabsTrigger value="profil" data-testid="tab-profil">Mon profil</TabsTrigger>
            <TabsTrigger value="tontines" data-testid="tab-tontines">Mes tontines</TabsTrigger>
            <TabsTrigger value="demandes" data-testid="tab-demandes">Mes demandes</TabsTrigger>
            <TabsTrigger value="cotisations" data-testid="tab-cotisations">Mes cotisations</TabsTrigger>
            <TabsTrigger value="paiements" data-testid="tab-paiements">Mes paiements</TabsTrigger>
            <TabsTrigger value="contrats" data-testid="tab-contrats">Mes contrats</TabsTrigger>
            <TabsTrigger value="prises" data-testid="tab-prises">Mes prises</TabsTrigger>
            <TabsTrigger value="notifications" data-testid="tab-notifications">Notifications{unread ? ` (${unread})` : ""}</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="mt-6 space-y-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat title="Total payé" value={fcfa(totals.paid)} testId="stat-total-paid" />
              <Stat title="Reste à payer" value={fcfa(totals.remaining)} testId="stat-total-remaining" />
              <Stat title="Pénalités" value={fcfa(totals.penalties)} testId="stat-total-penalties" />
              <Stat title="Jours en retard" value={String(totals.late)} testId="stat-late-days" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {(summaries.data ?? []).map((s) => (
                <div key={s.tontine_id} className="rounded-2xl border border-border/70 bg-card p-5" data-testid={`summary-card-${s.tontine_id}`}>
                  <p className="font-heading text-xl">{s.tontine_name}</p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${s.progress}%` }} />
                  </div>
                  <p className="mt-2 text-sm">{s.progress}% régularisé — {s.paid_days} jours payés, {s.remaining_days} jours restants</p>
                  <p className="mt-1 text-sm text-muted-foreground">Prochaine échéance : {s.next_due_date ?? "—"}</p>
                </div>
              ))}
              {(summaries.data ?? []).length === 0 && <Empty text="Aucune cotisation en cours." testId="summary-empty" />}
            </div>
          </TabsContent>

          <TabsContent value="profil" className="mt-6">
            <div className="rounded-2xl border border-border/70 bg-card p-6">
              <h2 className="font-heading text-2xl">Complétez vos informations personnelles</h2>
              <p className="mt-1 text-sm text-muted-foreground">Ces informations sont nécessaires avant toute adhésion.</p>
              <div className="mt-6">{me && <ProfileForm me={me} />}</div>
              <Link to="/tontines-disponibles" className={buttonVariants({ variant: "ghost", className: "mt-4" })} data-testid="profile-to-tontines-link">
                Voir les tontines disponibles
              </Link>
            </div>
          </TabsContent>

          <TabsContent value="tontines" className="mt-6 grid gap-4 md:grid-cols-2" data-testid="my-tontines-list">
            {(mine.data ?? []).map((m) => (
              <div key={m.tontine.id} className="rounded-2xl border border-border/70 bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-heading text-xl">{m.tontine.name}</p>
                  <StatusPill value={m.tontine.status} />
                </div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{m.tontine.gerance_name}</p>
                <p className="mt-3 text-sm">
                  Branches : <strong>{m.branches}</strong> · cotisation {fcfa(m.daily_total)} / jour
                  {m.branches > 1 && <span className="text-muted-foreground"> ({fcfa(m.tontine.daily_amount)} × {m.branches})</span>}
                </p>
                <p className="text-sm">Ma position : {m.position_index ?? "non attribuée"} {m.payout_date ? `— prise le ${m.payout_date}` : ""}</p>
                <p className="text-sm text-muted-foreground">Contrat : {m.contract_status ? label(m.contract_status) : "—"}</p>
              </div>
            ))}
            {(mine.data ?? []).length === 0 && <Empty text="Vous ne participez à aucune tontine pour l'instant." testId="my-tontines-empty" />}
          </TabsContent>

          <TabsContent value="demandes" className="mt-6 space-y-2" data-testid="my-requests-list">
            {(requests.data ?? []).map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 text-sm">
                <span className="font-medium">{r.tontine_name}</span>
                <span className="text-muted-foreground">{r.gerance_name}</span>
                {r.branches > 1 && <span className="text-xs text-primary">{r.branches} branches · {fcfa(r.daily_total)}/jour</span>}
                <span className="ml-auto"><StatusPill value={r.status} /></span>
              </div>
            ))}
            {(requests.data ?? []).length === 0 && <Empty text="Aucune demande d'adhésion." testId="my-requests-empty" />}
          </TabsContent>

          <TabsContent value="cotisations" className="mt-6">
            <PayDialogSection dues={dues.data ?? []} methods={methods.data} />
          </TabsContent>

          <TabsContent value="paiements" className="mt-6 space-y-2" data-testid="my-payments-list">
            {(payments.data ?? []).map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 text-sm">
                <span className="font-medium">{fcfa(p.amount)}</span>
                <span className="text-muted-foreground">{p.tontine_name}</span>
                <span className="text-xs text-muted-foreground">{p.days.length} jour(s){p.method_name ? ` · ${p.method_name}` : ""}</span>
                {p.receipt_number && <span className="text-xs text-primary" data-testid={`receipt-${p.id}`}>Reçu {p.receipt_number}</span>}
                {p.penalty_amount > 0 && <span className="text-xs text-red-700">dont {fcfa(p.penalty_amount)} de pénalités</span>}
                <span className="ml-auto"><StatusPill value={p.status} /></span>
              </div>
            ))}
            {(payments.data ?? []).length === 0 && <Empty text="Aucun paiement envoyé." testId="my-payments-empty" />}
          </TabsContent>

          <TabsContent value="contrats" className="mt-6 grid gap-4 md:grid-cols-2" data-testid="my-contracts-list">
            {(contracts.data ?? []).map((c) => (
              <div key={c.id} className="rounded-2xl border border-border/70 bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-heading text-xl">{c.tontine_name}</p>
                  <StatusPill value={c.status} />
                </div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{c.gerance_name}</p>
                <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                  <li>Cotisation : {fcfa(Number(c.terms.daily_amount))} / jour — heure limite {String(c.terms.deadline_time)}</li>
                  <li>Prise : {fcfa(Number(c.terms.payout_amount))} tous les {String(c.terms.interval_days)} jours</li>
                  <li>Durée : {String(c.terms.duration_days)} jours ({String(c.terms.start_date)} → {String(c.terms.end_date)})</li>
                  <li>Pénalité : {fcfa(Number(c.terms.penalty_per_day))} par jour de retard</li>
                  <li>Position : {c.position_index ?? "à attribuer"} {c.payout_date ? `— ${c.payout_date}` : ""}</li>
                </ul>
                {c.status !== "signed" && (
                  <Button className="mt-4" onClick={() => sign.mutate(c.id)} disabled={sign.isPending} data-testid={`sign-contract-${c.id}`}>
                    Signer mon contrat
                  </Button>
                )}
              </div>
            ))}
            {(contracts.data ?? []).length === 0 && <Empty text="Aucun contrat généré." testId="my-contracts-empty" />}
          </TabsContent>

          <TabsContent value="prises" className="mt-6 space-y-2" data-testid="my-payouts-list">
            {(payouts.data ?? []).map((p) => (
              <div key={p.id} className="rounded-xl border border-border/70 bg-card px-4 py-3 text-sm">
                <p className="font-medium">Reçu de prise — {fcfa(p.amount)}</p>
                <p className="text-muted-foreground">
                  {p.tontine_name} · {p.gerance_name} · position {p.position_index} · {p.payout_date} · confirmé par {p.confirmed_by_name}
                </p>
              </div>
            ))}
            {(payouts.data ?? []).length === 0 && <Empty text="Aucune prise reçue pour le moment." testId="my-payouts-empty" />}
          </TabsContent>

          <TabsContent value="notifications" className="mt-6 space-y-2" data-testid="my-notifications-list">
            {(notifications.data ?? []).map((n) => (
              <div key={n.id} className={`rounded-xl border px-4 py-3 text-sm ${n.read ? "border-border/60 bg-card" : "border-primary/30 bg-primary/5"}`}>
                <p className="font-medium">{n.title}</p>
                <p className="text-muted-foreground">{n.message}</p>
              </div>
            ))}
            {(notifications.data ?? []).length === 0 && <Empty text="Aucune notification." testId="my-notifications-empty" />}
          </TabsContent>
        </Tabs>
      </div>
      <BottomBar
        value={tab}
        onChange={setTab}
        items={[
          { value: "dashboard", text: "Accueil", icon: LayoutDashboard },
          { value: "cotisations", text: "Cotisations", icon: CalendarClock },
          { value: "tontines", text: "Tontines", icon: Users },
          { value: "notifications", text: "Alertes", icon: Bell, badge: unread },
        ]}
      />
    </PublicLayout>
  );
}
