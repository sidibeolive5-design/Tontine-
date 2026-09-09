import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PublicLayout, Stat, StatusPill, Empty } from "@/components/Shell";
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
  PERMISSION_LABELS,
  type AuditRow,
  type DueDate,
  type Gerance,
  type Manager,
  type MembershipRequest,
  type MyGerance,
  type Notification,
  type Payment,
  type Payout,
  type Position,
  type Tontine,
} from "@/lib/types";

const detail = (e: unknown, fallback: string) =>
  (e instanceof ApiError ? (e.body as { detail?: string } | null)?.detail : null) ?? fallback;

function CreateTontineForm() {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: "",
    description: "",
    member_count: 20,
    daily_amount: 550,
    payout_amount: 50000,
    interval_days: 5,
    beneficiary_count: 20,
    duration_days: 100,
    start_date: new Date().toISOString().slice(0, 10),
    deadline_time: "18:00",
    penalty_per_day: 500,
    is_existing: false,
  });
  const num = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: Number(e.target.value) });

  const create = useMutation({
    mutationFn: () => apiPost<Tontine>("/tontines", { ...f, status: "open", timezone: "Africa/Abidjan" }),
    onSuccess: (t) => {
      toast.success(`Tontine « ${t.name} » créée dans ${t.gerance_name}`);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Création impossible")),
  });

  const fields: [keyof typeof f, string][] = [
    ["member_count", "Nombre de membres"],
    ["daily_amount", "Cotisation quotidienne (FCFA)"],
    ["payout_amount", "Montant bénéficiaire (FCFA)"],
    ["interval_days", "Intervalle entre prises (jours)"],
    ["beneficiary_count", "Nombre de bénéficiaires"],
    ["duration_days", "Durée (jours)"],
    ["penalty_per_day", "Pénalité / jour (FCFA)"],
  ];

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="t-name">Nom de la tontine</Label>
        <Input id="t-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="tontine-name-input" />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="t-desc">Description</Label>
        <Textarea id="t-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} data-testid="tontine-description-input" />
      </div>
      {fields.map(([k, l]) => (
        <div key={k} className="space-y-2">
          <Label htmlFor={`t-${k}`}>{l}</Label>
          <Input id={`t-${k}`} type="number" min={1} value={String(f[k])} onChange={num(k)} data-testid={`tontine-${k}-input`} />
        </div>
      ))}
      <div className="space-y-2">
        <Label htmlFor="t-start">Date de début</Label>
        <Input id="t-start" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} data-testid="tontine-startdate-input" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="t-deadline">Heure limite</Label>
        <Input id="t-deadline" type="time" value={f.deadline_time} onChange={(e) => setF({ ...f, deadline_time: e.target.value })} data-testid="tontine-deadline-input" />
      </div>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Checkbox checked={f.is_existing} onCheckedChange={(v) => setF({ ...f, is_existing: Boolean(v) })} data-testid="tontine-existing-checkbox" />
        <span className="text-sm">Tontine existante déjà en cours (l'historique sera saisi manuellement)</span>
      </div>
      <Button type="submit" className="sm:col-span-2" disabled={create.isPending} data-testid="tontine-create-button">
        {create.isPending ? "Création…" : "Créer la tontine"}
      </Button>
    </form>
  );
}

function TontineCard({ t }: { t: Tontine }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const positions = useQuery({
    queryKey: ["tontine", t.id, "positions"],
    queryFn: () => apiGet<Position[]>(`/tontines/${t.id}/positions`),
    enabled: open,
    retry: false,
  });
  const members = useQuery({
    queryKey: ["tontine", t.id, "members"],
    queryFn: () => apiGet<{ member_id: string; name: string }[]>(`/tontines/${t.id}/members`),
    enabled: open,
    retry: false,
  });

  const assign = useMutation({
    mutationFn: (v: { position_id: string; member_id: string | null }) =>
      apiPatch<Position>(`/positions/${v.position_id}/assign`, { member_id: v.member_id }),
    onSuccess: () => {
      toast.success("Position mise à jour");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Attribution impossible")),
  });

  const queue = useMutation({
    mutationFn: (position_id: string) => apiPost<Position[]>(`/positions/${position_id}/queue`),
    onSuccess: () => {
      toast.success("Membre passé à la queue");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Action impossible")),
  });

  const payout = useMutation({
    mutationFn: (position_id: string) => apiPost<Payout>("/payouts/confirm", { position_id }),
    onSuccess: () => {
      toast.success("Prise confirmée — reçu généré");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Confirmation impossible")),
  });

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-5" data-testid={`tontine-card-${t.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-heading text-xl">{t.name}</p>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{t.gerance_name}</p>
        </div>
        <StatusPill value={t.status} />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {fcfa(t.daily_amount)} / jour · prise {fcfa(t.payout_amount)} tous les {t.interval_days} jours · {t.joined_count}/{t.member_count} membres
      </p>
      <div className="mt-4 flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)} data-testid={`tontine-positions-toggle-${t.id}`}>
          {open ? "Masquer les positions" : "Gérer les positions"}
        </Button>
        <Link to={`/details-tontine?id=${t.id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
          Page publique
        </Link>
      </div>
      {open && (
        <div className="mt-4 space-y-2" data-testid={`positions-panel-${t.id}`}>
          {(positions.data ?? []).map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-sm">
              <span className="w-24 font-medium">Position {p.index}</span>
              <span className="w-28 text-muted-foreground">{p.payout_date}</span>
              <select
                className="rounded-lg border border-input bg-background px-2 py-1 text-sm"
                value={p.member_id ?? ""}
                data-testid={`position-select-${p.id}`}
                onChange={(e) => assign.mutate({ position_id: p.id, member_id: e.target.value || null })}
              >
                <option value="">— Libre —</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.member_id} value={m.member_id}>{m.name}</option>
                ))}
              </select>
              <StatusPill value={p.status} />
              <div className="ml-auto flex gap-2">
                <Button size="xs" variant="ghost" onClick={() => queue.mutate(p.id)} data-testid={`position-queue-${p.id}`}>
                  Passer à la queue
                </Button>
                <Button size="xs" disabled={!p.member_id || p.status === "received"} onClick={() => payout.mutate(p.id)} data-testid={`position-payout-${p.id}`}>
                  Confirmer la prise
                </Button>
              </div>
            </div>
          ))}
          {(positions.data ?? []).length === 0 && <Empty text="Aucune position générée." />}
        </div>
      )}
    </div>
  );
}

function CreateManagerForm() {
  const qc = useQueryClient();
  const [f, setF] = useState({ first_name: "", last_name: "", phone: "", email: "", password: "" });
  const [perms, setPerms] = useState<string[]>(Object.keys(PERMISSION_LABELS));

  const create = useMutation({
    mutationFn: () => apiPost<Manager>("/managers", { ...f, permissions: perms }),
    onSuccess: (m) => {
      toast.success(`${m.gerance_name} créée`);
      setF({ first_name: "", last_name: "", phone: "", email: "", password: "" });
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Création impossible")),
  });

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      {([["first_name", "Prénom"], ["last_name", "Nom"], ["phone", "Téléphone"], ["email", "Email"]] as const).map(([k, l]) => (
        <div key={k} className="space-y-2">
          <Label htmlFor={`m-${k}`}>{l}</Label>
          <Input id={`m-${k}`} required value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`manager-${k}-input`} />
        </div>
      ))}
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="m-password">Mot de passe provisoire</Label>
        <Input id="m-password" type="password" required minLength={6} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} data-testid="manager-password-input" />
        <p className="text-xs text-muted-foreground">Communiquez-le au gérant : il pourra le modifier depuis son espace.</p>
      </div>
      <div className="sm:col-span-2">
        <p className="text-sm font-medium">Permissions</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {Object.entries(PERMISSION_LABELS).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={perms.includes(k)}
                onCheckedChange={(v) => setPerms((p) => (v ? [...p, k] : p.filter((x) => x !== k)))}
                data-testid={`manager-perm-${k}`}
              />
              {l}
            </label>
          ))}
        </div>
      </div>
      <Button type="submit" className="sm:col-span-2" disabled={create.isPending} data-testid="manager-create-button">
        {create.isPending ? "Création…" : "Créer le gérant et sa gérance"}
      </Button>
    </form>
  );
}

export default function StaffSpace({ mode }: { mode: "admin" | "manager" }) {
  const { data: me, isLoading } = useMe();
  const qc = useQueryClient();
  const [tab, setTab] = useState("dashboard");
  const isAdmin = mode === "admin";

  const myGerance = useQuery({ queryKey: ["my-gerance"], queryFn: () => apiGet<MyGerance>("/my-gerance"), retry: false });
  const myTontines = useQuery({ queryKey: ["tontines", "mine"], queryFn: () => apiGet<Tontine[]>("/tontines/mine"), retry: false });
  const gerances = useQuery({ queryKey: ["gerances"], queryFn: () => apiGet<Gerance[]>("/gerances"), enabled: isAdmin, retry: false });
  const managers = useQuery({ queryKey: ["managers"], queryFn: () => apiGet<Manager[]>("/managers"), enabled: isAdmin, retry: false });
  const requests = useQuery({ queryKey: ["memberships", "requests"], queryFn: () => apiGet<MembershipRequest[]>("/memberships/requests"), retry: false });
  const payments = useQuery({ queryKey: ["payments"], queryFn: () => apiGet<Payment[]>("/payments"), retry: false });
  const dues = useQuery({ queryKey: ["due-dates"], queryFn: () => apiGet<DueDate[]>("/due-dates"), retry: false });
  const payouts = useQuery({ queryKey: ["payouts"], queryFn: () => apiGet<Payout[]>("/payouts"), retry: false });
  const audits = useQuery({ queryKey: ["audit"], queryFn: () => apiGet<AuditRow[]>("/audit"), retry: false });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => apiGet<Notification[]>("/notifications"), retry: false });

  const decideRequest = useMutation({
    mutationFn: (v: { id: string; action: string }) => apiPost(`/memberships/requests/${v.id}/decide`, { action: v.action }),
    onSuccess: () => {
      toast.success("Demande traitée");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Action impossible")),
  });

  const decidePayment = useMutation({
    mutationFn: (v: { id: string; action: string }) => apiPost(`/payments/${v.id}/decide`, { action: v.action }),
    onSuccess: (_d, v) => {
      toast.success(v.action === "validate" ? "Paiement validé ✅" : "Paiement rejeté ⚠️");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Action impossible")),
  });

  const updateManager = useMutation({
    mutationFn: (v: { id: string; status: string }) => apiPatch(`/managers/${v.id}`, { status: v.status }),
    onSuccess: () => {
      toast.success("Gérant mis à jour");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Action impossible")),
  });

  if (!isLoading && (!me || (isAdmin ? me.role !== "admin" : me.role !== "manager"))) {
    return (
      <PublicLayout>
        <div className="mx-auto max-w-md px-5 py-20 text-center">
          <h1 className="font-heading text-3xl">Accès réservé</h1>
          <p className="mt-2 text-muted-foreground">Cet espace est réservé {isAdmin ? "à l'administrateur principal" : "aux gérants"}.</p>
          <Link to="/connexion" className={buttonVariants({ className: "mt-6" })} data-testid="staff-login-redirect">Se connecter</Link>
        </div>
      </PublicLayout>
    );
  }

  const g = myGerance.data;
  const pendingPayments = (payments.data ?? []).filter((p) => p.status === "pending");

  return (
    <PublicLayout>
      <div className="mx-auto w-full max-w-6xl px-5 py-10">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">{isAdmin ? "Administration" : "Gérance"}</p>
        <h1 className="font-heading text-4xl" data-testid="staff-space-title">
          {isAdmin ? "Administrateur principal" : g?.name ?? "Ma gérance"}
        </h1>

        <Tabs value={tab} onValueChange={setTab} className="mt-8">
          <TabsList variant="line" className="flex-wrap">
            <TabsTrigger value="dashboard" data-testid="tab-dashboard">Tableau de bord</TabsTrigger>
            <TabsTrigger value="ma-gerance" data-testid="tab-ma-gerance">Ma gérance</TabsTrigger>
            {isAdmin && <TabsTrigger value="supervision" data-testid="tab-supervision">Supervision des gérances</TabsTrigger>}
            {isAdmin && <TabsTrigger value="gerants" data-testid="tab-gerants">Gérants</TabsTrigger>}
            <TabsTrigger value="demandes" data-testid="tab-demandes">Demandes d'adhésion</TabsTrigger>
            <TabsTrigger value="paiements" data-testid="tab-paiements">Paiements</TabsTrigger>
            <TabsTrigger value="cotisations" data-testid="tab-cotisations">Cotisations</TabsTrigger>
            <TabsTrigger value="prises" data-testid="tab-prises">Prises</TabsTrigger>
            <TabsTrigger value="notifications" data-testid="tab-notifications">Notifications</TabsTrigger>
            <TabsTrigger value="audit" data-testid="tab-audit">Historique &amp; audit</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="mt-6 space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat title="Tontines (ma gérance)" value={String(g?.tontine_count ?? 0)} testId="stat-tontines" />
              <Stat title="Membres" value={String(g?.member_count ?? 0)} testId="stat-members" />
              <Stat title="Total encaissé" value={fcfa(g?.total_paid ?? 0)} testId="stat-paid" />
              <Stat title="Paiements à vérifier" value={String(pendingPayments.length)} testId="stat-pending-payments" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat title="Total attendu" value={fcfa(g?.total_expected ?? 0)} testId="stat-expected" />
              <Stat title="En attente" value={fcfa(g?.total_pending ?? 0)} testId="stat-pending" />
              <Stat title="En retard" value={fcfa(g?.total_late ?? 0)} testId="stat-late" />
              <Stat title="Pénalités" value={fcfa(g?.total_penalties ?? 0)} testId="stat-penalties" />
            </div>
          </TabsContent>

          <TabsContent value="ma-gerance" className="mt-6 space-y-6">
            <div className="rounded-2xl border border-border/70 bg-card p-6">
              <h2 className="font-heading text-2xl">Créer une tontine</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Elle sera automatiquement rattachée à {g?.name ?? "votre gérance"}.
              </p>
              <div className="mt-6"><CreateTontineForm /></div>
            </div>
            <div className="grid gap-4 md:grid-cols-2" data-testid="my-gerance-tontines">
              {(myTontines.data ?? []).map((t) => <TontineCard key={t.id} t={t} />)}
              {(myTontines.data ?? []).length === 0 && <Empty text="Aucune tontine dans cette gérance." testId="my-gerance-tontines-empty" />}
            </div>
          </TabsContent>

          {isAdmin && (
            <TabsContent value="supervision" className="mt-6 grid gap-4 md:grid-cols-2" data-testid="supervision-list">
              {(gerances.data ?? []).map((x) => (
                <div key={x.id} className="rounded-2xl border border-border/70 bg-card p-5" data-testid={`gerance-card-${x.id}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-heading text-xl">{x.name}</p>
                    {x.is_admin_gerance && <StatusPill value="active" />}
                  </div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Responsable : {x.owner_name}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    <span>Tontines : {x.tontine_count}</span>
                    <span>Membres : {x.member_count}</span>
                    <span>Attendu : {fcfa(x.total_expected)}</span>
                    <span>Payé : {fcfa(x.total_paid)}</span>
                    <span>En retard : {fcfa(x.total_late)}</span>
                    <span>Pénalités : {fcfa(x.total_penalties)}</span>
                  </div>
                </div>
              ))}
              {(gerances.data ?? []).length === 0 && <Empty text="Aucune gérance." testId="supervision-empty" />}
            </TabsContent>
          )}

          {isAdmin && (
            <TabsContent value="gerants" className="mt-6 space-y-6">
              <div className="rounded-2xl border border-border/70 bg-card p-6">
                <h2 className="font-heading text-2xl">Créer un gérant</h2>
                <div className="mt-6"><CreateManagerForm /></div>
              </div>
              <div className="space-y-2" data-testid="managers-list">
                {(managers.data ?? []).map((m) => (
                  <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 text-sm">
                    <span className="font-medium">{m.first_name} {m.last_name}</span>
                    <span className="text-muted-foreground">{m.email}</span>
                    <span className="text-xs text-muted-foreground">{m.gerance_name} · {m.tontine_count} tontine(s)</span>
                    <StatusPill value={m.status} />
                    <div className="ml-auto flex gap-2">
                      <Button size="xs" variant="ghost" onClick={() => updateManager.mutate({ id: m.id, status: "suspended" })} data-testid={`manager-suspend-${m.id}`}>Suspendre</Button>
                      <Button size="xs" variant="ghost" onClick={() => updateManager.mutate({ id: m.id, status: "active" })} data-testid={`manager-activate-${m.id}`}>Réactiver</Button>
                    </div>
                  </div>
                ))}
                {(managers.data ?? []).length === 0 && <Empty text="Aucun gérant créé." testId="managers-empty" />}
              </div>
            </TabsContent>
          )}

          <TabsContent value="demandes" className="mt-6 space-y-2" data-testid="staff-requests-list">
            {(requests.data ?? []).map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 text-sm" data-testid={`request-row-${r.id}`}>
                <span className="font-medium">{r.member_name}</span>
                <span className="text-muted-foreground">{r.tontine_name}</span>
                <span className="text-xs text-muted-foreground">{r.gerance_name}</span>
                <StatusPill value={r.status} />
                {r.status === "pending" && (
                  <div className="ml-auto flex gap-2">
                    <Button size="xs" onClick={() => decideRequest.mutate({ id: r.id, action: "accept" })} data-testid={`request-accept-${r.id}`}>Accepter</Button>
                    <Button size="xs" variant="ghost" onClick={() => decideRequest.mutate({ id: r.id, action: "reject" })} data-testid={`request-reject-${r.id}`}>Refuser</Button>
                  </div>
                )}
              </div>
            ))}
            {(requests.data ?? []).length === 0 && <Empty text="Aucune demande d'adhésion." testId="staff-requests-empty" />}
          </TabsContent>

          <TabsContent value="paiements" className="mt-6 space-y-2" data-testid="staff-payments-list">
            {(payments.data ?? []).map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 text-sm" data-testid={`payment-row-${p.id}`}>
                <span className="font-medium">{p.member_name}</span>
                <span>{fcfa(p.amount)}</span>
                <span className="text-xs text-muted-foreground">{p.tontine_name} · {p.gerance_name} · {p.days.length} jour(s)</span>
                <StatusPill value={p.status} />
                {p.status === "pending" && (
                  <div className="ml-auto flex gap-2">
                    <Button size="xs" onClick={() => decidePayment.mutate({ id: p.id, action: "validate" })} data-testid={`payment-validate-${p.id}`}>Valider le paiement</Button>
                    <Button size="xs" variant="ghost" onClick={() => decidePayment.mutate({ id: p.id, action: "reject" })} data-testid={`payment-reject-${p.id}`}>Rejeter</Button>
                  </div>
                )}
              </div>
            ))}
            {(payments.data ?? []).length === 0 && <Empty text="Aucun paiement." testId="staff-payments-empty" />}
          </TabsContent>

          <TabsContent value="cotisations" className="mt-6 space-y-2" data-testid="staff-dues-list">
            {(dues.data ?? []).slice(0, 200).map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card px-4 py-2.5 text-sm">
                <span className="w-40 truncate font-medium">{d.member_name}</span>
                <span className="w-24">{d.date}</span>
                <span className="w-16 text-muted-foreground">{d.deadline_time}</span>
                <span className="w-28">{fcfa(d.amount)}</span>
                <span className="flex-1 truncate text-xs text-muted-foreground">{d.tontine_name}</span>
                {d.penalty > 0 && <span className="text-xs text-red-700">+{fcfa(d.penalty)}</span>}
                <StatusPill value={d.display_status} />
              </div>
            ))}
            {(dues.data ?? []).length === 0 && <Empty text="Aucune échéance enregistrée." testId="staff-dues-empty" />}
          </TabsContent>

          <TabsContent value="prises" className="mt-6 space-y-2" data-testid="staff-payouts-list">
            {(payouts.data ?? []).map((p) => (
              <div key={p.id} className="rounded-xl border border-border/70 bg-card px-4 py-3 text-sm">
                <p className="font-medium">{p.member_name} — {fcfa(p.amount)}</p>
                <p className="text-muted-foreground">{p.tontine_name} · {p.gerance_name} · position {p.position_index} · {p.payout_date} · confirmé par {p.confirmed_by_name}</p>
              </div>
            ))}
            {(payouts.data ?? []).length === 0 && <Empty text="Aucune prise confirmée." testId="staff-payouts-empty" />}
          </TabsContent>

          <TabsContent value="notifications" className="mt-6 space-y-2" data-testid="staff-notifications-list">
            {(notifications.data ?? []).map((n) => (
              <div key={n.id} className={`rounded-xl border px-4 py-3 text-sm ${n.read ? "border-border/60 bg-card" : "border-primary/30 bg-primary/5"}`}>
                <p className="font-medium">{n.title}</p>
                <p className="text-muted-foreground">{n.message}</p>
              </div>
            ))}
            {(notifications.data ?? []).length === 0 && <Empty text="Aucune notification." testId="staff-notifications-empty" />}
          </TabsContent>

          <TabsContent value="audit" className="mt-6 space-y-2" data-testid="audit-list">
            {(audits.data ?? []).map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card px-4 py-2.5 text-sm">
                <span className="font-medium">{a.actor_name}</span>
                <span className="text-xs uppercase tracking-wider text-muted-foreground">{label(a.actor_role)}</span>
                <span>{a.action}</span>
                <span className="ml-auto text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString("fr-FR")}</span>
              </div>
            ))}
            {(audits.data ?? []).length === 0 && <Empty text="Aucune opération enregistrée." testId="audit-empty" />}
          </TabsContent>
        </Tabs>
      </div>
    </PublicLayout>
  );
}
