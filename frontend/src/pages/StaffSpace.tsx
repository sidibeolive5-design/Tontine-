import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PublicLayout, Stat, StatusPill, Empty, BottomBar, scrollTabs } from "@/components/Shell";
import SettingsPanel from "@/components/SettingsPanel";
import { LayoutDashboard, Landmark, Trash2, UserPlus, Wallet } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { useMe } from "@/lib/session";
import {
  fcfa,
  label,
  PERMISSION_LABELS,
  type ArrearRow,
  type AuditRow,
  type DueDate,
  type EditImpact,
  type Gerance,
  type ImportResult,
  type Invitation,
  type Manager,
  type MemberRow,
  type MemberFile,
  type TrashMember,
  type PaymentProof,
  type MembershipRequest,
  type ArrearsExport,
  type MyGerance,
  type Notification,
  type Payment,
  type Payout,
  type Position,
  type RemindResult,
  type Tontine,
} from "@/lib/types";

const detail = (e: unknown, fallback: string) =>
  (e instanceof ApiError ? (e.body as { detail?: string } | null)?.detail : null) ?? fallback;

// "saisie_gérant" / "historique_administrateur" -> "le gérant" / "l'administrateur"
const byLabel = (source: string) =>
  source.endsWith("administrateur") ? "l'administrateur" : "le gérant";

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
    allow_multi_branch: false,
    max_branches_per_member: 1,
    total_branches: null as number | null,
    penalty_mode: "member",
    turn_mode: "manual",
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
      <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/30 p-4 sm:col-span-2">
        <p className="text-sm font-medium">Branches (parts) par membre</p>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={f.allow_multi_branch}
            onCheckedChange={(v) => setF({ ...f, allow_multi_branch: Boolean(v), max_branches_per_member: v ? 3 : 1 })}
            data-testid="tontine-multibranch-checkbox"
          />
          Autoriser plusieurs branches par membre
        </label>
        {f.allow_multi_branch && (
          <div className="space-y-2">
            <Label htmlFor="t-maxbranch">Nombre maximum de branches par membre</Label>
            <Input
              id="t-maxbranch"
              type="number"
              min={1}
              value={String(f.max_branches_per_member)}
              onChange={(e) => setF({ ...f, max_branches_per_member: Number(e.target.value) })}
              data-testid="tontine-maxbranches-input"
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="t-totalbranch">Nombre total de branches disponibles (vide = nombre de membres)</Label>
          <Input
            id="t-totalbranch"
            type="number"
            min={1}
            value={f.total_branches === null ? "" : String(f.total_branches)}
            onChange={(e) => setF({ ...f, total_branches: e.target.value ? Number(e.target.value) : null })}
            data-testid="tontine-totalbranches-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="t-penalmode">Mode de calcul de la pénalité</Label>
          <select
            id="t-penalmode"
            className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
            value={f.penalty_mode}
            onChange={(e) => setF({ ...f, penalty_mode: e.target.value })}
            data-testid="tontine-penaltymode-select"
          >
            <option value="member">Par membre</option>
            <option value="branch">Par branche</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="t-turnmode">Gestion des tours / branches</Label>
          <select
            id="t-turnmode"
            className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
            value={f.turn_mode}
            onChange={(e) => setF({ ...f, turn_mode: e.target.value })}
            data-testid="tontine-turnmode-select"
          >
            <option value="manual">Manuelle par le gérant</option>
            <option value="auto">Automatique</option>
          </select>
        </div>
      </div>
      <Button type="submit" className="sm:col-span-2" disabled={create.isPending} data-testid="tontine-create-button">
        {create.isPending ? "Création…" : "Créer la tontine"}
      </Button>
    </form>
  );
}

const EDIT_NUMBER_FIELDS: [keyof EditForm, string][] = [
  ["member_count", "Nombre de membres"],
  ["daily_amount", "Cotisation quotidienne (FCFA)"],
  ["payout_amount", "Montant bénéficiaire (FCFA)"],
  ["interval_days", "Intervalle entre prises (jours)"],
  ["beneficiary_count", "Nombre de bénéficiaires"],
  ["duration_days", "Durée (jours)"],
  ["penalty_per_day", "Pénalité / jour (FCFA)"],
];

type EditForm = {
  name: string;
  description: string;
  status: string;
  member_count: number;
  daily_amount: number;
  payout_amount: number;
  interval_days: number;
  beneficiary_count: number;
  duration_days: number;
  penalty_per_day: number;
  start_date: string;
  deadline_time: string;
  allow_multi_branch: boolean;
  max_branches_per_member: number;
  total_branches: number | null;
  penalty_mode: string;
  turn_mode: string;
};

const STATUS_OPTIONS: [string, string][] = [
  ["draft", "Brouillon"],
  ["pending_validation", "En attente de validation"],
  ["open", "Ouverte"],
  ["running", "En cours"],
  ["finished", "Terminée"],
  ["suspended", "Suspendue"],
  ["cancelled", "Annulée"],
];

function EditTontineDialog({ t, onClose }: { t: Tontine | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<EditForm | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!t) {
      setF(null);
      setConfirming(false);
      return;
    }
    setF({
      name: t.name,
      description: t.description,
      status: t.status,
      member_count: t.member_count,
      daily_amount: t.daily_amount,
      payout_amount: t.payout_amount,
      interval_days: t.interval_days,
      beneficiary_count: t.beneficiary_count,
      duration_days: t.duration_days,
      penalty_per_day: t.penalty_per_day,
      start_date: t.start_date,
      deadline_time: t.deadline_time,
      allow_multi_branch: t.allow_multi_branch,
      max_branches_per_member: t.max_branches_per_member,
      total_branches: t.total_branches,
      penalty_mode: t.penalty_mode,
      turn_mode: t.turn_mode,
    });
    setConfirming(false);
  }, [t]);

  const structural =
    Boolean(t && f) &&
    (f!.start_date !== t!.start_date ||
      f!.interval_days !== t!.interval_days ||
      f!.duration_days !== t!.duration_days ||
      f!.beneficiary_count !== t!.beneficiary_count ||
      f!.daily_amount !== t!.daily_amount ||
      f!.deadline_time !== t!.deadline_time);

  const impact = useQuery({
    queryKey: ["tontine", t?.id, "edit-impact", f?.start_date, f?.interval_days, f?.duration_days, f?.beneficiary_count],
    queryFn: () =>
      apiGet<EditImpact>(
        `/tontines/${t!.id}/edit-impact?start_date=${f!.start_date}&interval_days=${f!.interval_days}` +
          `&duration_days=${f!.duration_days}&beneficiary_count=${f!.beneficiary_count}`,
      ),
    enabled: Boolean(t && f && confirming),
    retry: false,
  });

  const save = useMutation({
    mutationFn: () => apiPatch<Tontine>(`/tontines/${t!.id}`, f),
    onSuccess: (up) => {
      toast.success(`« ${up.name} » mise à jour`);
      qc.invalidateQueries();
      onClose();
    },
    onError: (e) => toast.error(detail(e, "Modification impossible")),
  });

  const num = (k: keyof EditForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => (p ? { ...p, [k]: Number(e.target.value) } : p));

  return (
    <Dialog open={Boolean(t)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-[95vw] overflow-y-auto sm:max-w-2xl" data-testid="edit-tontine-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">Modifier « {t?.name} »</DialogTitle>
        </DialogHeader>
        {f && !confirming && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="e-name">Nom de la tontine</Label>
              <Input id="e-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="edit-tontine-name-input" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="e-desc">Description</Label>
              <Textarea id="e-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} data-testid="edit-tontine-description-input" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="e-status">Statut</Label>
              <select
                id="e-status"
                className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                value={f.status}
                onChange={(e) => setF({ ...f, status: e.target.value })}
                data-testid="edit-tontine-status-select"
              >
                {STATUS_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="e-start">Date de début</Label>
              <Input id="e-start" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} data-testid="edit-tontine-startdate-input" />
            </div>
            {EDIT_NUMBER_FIELDS.map(([k, l]) => (
              <div key={k} className="space-y-2">
                <Label htmlFor={`e-${k}`}>{l}</Label>
                <Input id={`e-${k}`} type="number" min={1} value={String(f[k])} onChange={num(k)} data-testid={`edit-tontine-${k}-input`} />
              </div>
            ))}
            <div className="space-y-2">
              <Label htmlFor="e-deadline">Heure limite</Label>
              <Input id="e-deadline" type="time" value={f.deadline_time} onChange={(e) => setF({ ...f, deadline_time: e.target.value })} data-testid="edit-tontine-deadline-input" />
            </div>
            <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/30 p-4 sm:col-span-2">
              <p className="text-sm font-medium">Branches (parts) par membre</p>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={f.allow_multi_branch}
                  onCheckedChange={(v) =>
                    setF({ ...f, allow_multi_branch: Boolean(v), max_branches_per_member: v ? Math.max(f.max_branches_per_member, 2) : 1 })
                  }
                  data-testid="edit-tontine-multibranch-checkbox"
                />
                Autoriser plusieurs branches par membre
              </label>
              {f.allow_multi_branch && (
                <div className="space-y-2">
                  <Label htmlFor="e-maxbranch">Maximum de branches par membre</Label>
                  <Input id="e-maxbranch" type="number" min={1} value={String(f.max_branches_per_member)} onChange={num("max_branches_per_member")} data-testid="edit-tontine-maxbranches-input" />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="e-totalbranch">Total de branches disponibles (vide = nombre de membres)</Label>
                <Input
                  id="e-totalbranch"
                  type="number"
                  min={1}
                  value={f.total_branches === null ? "" : String(f.total_branches)}
                  onChange={(e) => setF({ ...f, total_branches: e.target.value ? Number(e.target.value) : null })}
                  data-testid="edit-tontine-totalbranches-input"
                />
                <p className="text-xs text-muted-foreground">{t?.branches_used} branche(s) déjà attribuée(s).</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="e-penalmode">Mode de calcul de la pénalité</Label>
                <select id="e-penalmode" className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm" value={f.penalty_mode} onChange={(e) => setF({ ...f, penalty_mode: e.target.value })} data-testid="edit-tontine-penaltymode-select">
                  <option value="member">Par membre</option>
                  <option value="branch">Par branche</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="e-turnmode">Gestion des tours</Label>
                <select id="e-turnmode" className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm" value={f.turn_mode} onChange={(e) => setF({ ...f, turn_mode: e.target.value })} data-testid="edit-tontine-turnmode-select">
                  <option value="manual">Manuelle par le gérant</option>
                  <option value="auto">Automatique</option>
                </select>
              </div>
            </div>
            {structural && (
              <p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-900 sm:col-span-2" data-testid="edit-tontine-structural-warning">
                ⚠️ Vous modifiez le calendrier (dates, durée, intervalle, cotisation ou heure limite). Les anciennes et
                nouvelles dates vous seront présentées avant enregistrement. Les jours déjà payés ou en cours de
                vérification sont protégés.
              </p>
            )}
            <Button
              className="sm:col-span-2"
              onClick={() => (structural ? setConfirming(true) : save.mutate())}
              disabled={save.isPending}
              data-testid="edit-tontine-submit-button"
            >
              {save.isPending ? "Enregistrement…" : structural ? "Voir l'impact et confirmer" : "Enregistrer les modifications"}
            </Button>
          </div>
        )}
        {f && confirming && (
          <div className="space-y-4" data-testid="edit-tontine-impact">
            {impact.isLoading && <p className="text-sm text-muted-foreground">Calcul de l'impact…</p>}
            {impact.data && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-border/60 p-3">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Anciennes dates de prise</p>
                    <ul className="mt-2 space-y-1 text-sm" data-testid="edit-tontine-old-dates">
                      {impact.data.old_dates.map((d, i) => <li key={`${d}-${i}`}>Position {i + 1} — {d}</li>)}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-primary/40 bg-primary/5 p-3">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Nouvelles dates de prise</p>
                    <ul className="mt-2 space-y-1 text-sm" data-testid="edit-tontine-new-dates">
                      {impact.data.new_dates.map((d, i) => <li key={`${d}-${i}`}>Position {i + 1} — {d}</li>)}
                    </ul>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Durée : {impact.data.old_duration_days} → {impact.data.new_duration_days} jours ·{" "}
                  {impact.data.received_positions} prise(s) déjà versée(s) conservée(s) ·{" "}
                  {impact.data.locked_days} jour(s) payé(s) ou en vérification protégé(s).
                </p>
              </>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)} data-testid="edit-tontine-back-button">
                Revenir aux champs
              </Button>
              <Button className="flex-1" onClick={() => save.mutate()} disabled={save.isPending} data-testid="edit-tontine-confirm-button">
                {save.isPending ? "Enregistrement…" : "Confirmer la modification"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TontineCard({ t }: { t: Tontine }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [historicalPosition, setHistoricalPosition] = useState<Position | null>(null);
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
        {" · "}{t.branches_used}/{t.total_branches ?? t.member_count} branches
        {t.allow_multi_branch ? ` · jusqu'à ${t.max_branches_per_member} branches/membre` : " · 1 branche/membre"}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)} data-testid={`tontine-positions-toggle-${t.id}`}>
          {open ? "Masquer les positions" : "Gérer les positions"}
        </Button>
        <Button size="sm" onClick={() => setEditing(true)} data-testid={`tontine-edit-button-${t.id}`}>
          Modifier la tontine
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
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!p.member_id || p.status === "received"}
                  onClick={() => setHistoricalPosition(p)}
                  data-testid={`position-historical-${p.id}`}
                >
                  Prise déjà versée
                </Button>
              </div>
            </div>
          ))}
          {(positions.data ?? []).length === 0 && <Empty text="Aucune position générée." />}
        </div>
      )}
      <HistoricalPayoutDialog position={historicalPosition} onClose={() => setHistoricalPosition(null)} />
      <EditTontineDialog t={editing ? t : null} onClose={() => setEditing(false)} />
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
        <p className="mt-1 text-xs text-muted-foreground">Communiquez-le au gérant : il en aura besoin pour sa première connexion.</p>
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

function RecordMemberPaymentCard({ tontines }: { tontines: Tontine[] }) {
  const qc = useQueryClient();
  const [tontineId, setTontineId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [proof, setProof] = useState<{ data: string; name: string } | null>(null);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [validateNow, setValidateNow] = useState(true);

  const members = useQuery({
    queryKey: ["tontine", tontineId, "members"],
    queryFn: () => apiGet<{ member_id: string; name: string }[]>(`/tontines/${tontineId}/members`),
    enabled: Boolean(tontineId),
    retry: false,
  });
  const memberDues = useQuery({
    queryKey: ["due-dates", tontineId, memberId],
    queryFn: () => apiGet<DueDate[]>(`/due-dates?tontine_id=${tontineId}&member_id=${memberId}`),
    enabled: Boolean(tontineId && memberId),
    retry: false,
  });

  const payable = (memberDues.data ?? []).filter((d) => d.status === "pending");
  const chosen = payable.filter((d) => selected.includes(d.id));
  const contributions = chosen.reduce((s, d) => s + d.amount, 0);
  const penalties = chosen.reduce((s, d) => s + d.penalty, 0);

  const reset = () => {
    setSelected([]);
    setProof(null);
    setReference("");
    setNote("");
  };

  const save = useMutation({
    mutationFn: () =>
      apiPost<Payment>("/payments/for-member", {
        tontine_id: tontineId,
        member_id: memberId,
        due_date_ids: selected,
        method: "wave",
        proof_image: proof?.data,
        proof_filename: proof?.name,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        validate_now: validateNow,
      }),
    onSuccess: (p) => {
      toast.success(
        p.status === "validated"
          ? `Paiement enregistré et validé${p.receipt_number ? ` — reçu ${p.receipt_number}` : ""}`
          : "Paiement enregistré — en attente de vérification",
      );
      reset();
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Enregistrement impossible")),
  });

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setProof({ data: String(reader.result), name: file.name });
    reader.readAsDataURL(file);
  };

  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:p-5" data-testid="record-member-payment-card">
      <h3 className="font-heading text-xl">Enregistrer un paiement pour un membre</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Pour un membre qui a payé sans envoyer sa preuve (espèces, dépôt direct, preuve reçue par WhatsApp).
        La saisie est tracée « saisie par le gérant / l'administrateur ».
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="rp-tontine">Tontine</Label>
          <select
            id="rp-tontine"
            className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
            value={tontineId}
            onChange={(e) => {
              setTontineId(e.target.value);
              setMemberId("");
              reset();
            }}
            data-testid="record-payment-tontine-select"
          >
            <option value="">— Choisir —</option>
            {tontines.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="rp-member">Membre</Label>
          <select
            id="rp-member"
            className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
            value={memberId}
            onChange={(e) => {
              setMemberId(e.target.value);
              setSelected([]);
            }}
            disabled={!tontineId}
            data-testid="record-payment-member-select"
          >
            <option value="">— Choisir —</option>
            {(members.data ?? []).map((m) => (
              <option key={m.member_id} value={m.member_id}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      {memberId && (
        <>
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Jours à régler ({payable.length} impayé(s))</p>
              <div className="flex gap-2">
                <Button size="xs" variant="outline" onClick={() => setSelected(payable.map((d) => d.id))} data-testid="record-payment-select-all">
                  Tout sélectionner
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setSelected([])} data-testid="record-payment-clear">
                  Vider
                </Button>
              </div>
            </div>
            <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1" data-testid="record-payment-days">
              {payable.map((d) => (
                <label key={d.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2 text-sm">
                  <Checkbox
                    checked={selected.includes(d.id)}
                    onCheckedChange={(v) => setSelected((s) => (v ? [...s, d.id] : s.filter((x) => x !== d.id)))}
                    data-testid={`record-payment-day-${d.id}`}
                  />
                  <span className="font-medium">{d.date}</span>
                  <span>{fcfa(d.amount)}</span>
                  {d.penalty > 0 && <span className="text-xs text-red-700">+{fcfa(d.penalty)} pénalité</span>}
                  <span className="ml-auto"><StatusPill value={d.display_status} /></span>
                </label>
              ))}
              {payable.length === 0 && <Empty text="Aucun jour impayé pour ce membre." testId="record-payment-days-empty" />}
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rp-ref">Référence / numéro de transaction (optionnel)</Label>
              <Input id="rp-ref" value={reference} onChange={(e) => setReference(e.target.value)} data-testid="record-payment-reference-input" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rp-proof">Preuve de paiement (optionnel)</Label>
              <Input
                id="rp-proof"
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                onChange={pickFile}
                data-testid="record-payment-proof-input"
              />
              {proof && <p className="text-xs text-muted-foreground" data-testid="record-payment-proof-name">Jointe : {proof.name}</p>}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="rp-note">Note interne (optionnel)</Label>
              <Textarea id="rp-note" value={note} onChange={(e) => setNote(e.target.value)} data-testid="record-payment-note-input" />
            </div>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm">
            <Checkbox checked={validateNow} onCheckedChange={(v) => setValidateNow(Boolean(v))} data-testid="record-payment-validate-checkbox" />
            Valider immédiatement (les jours passent en « payé » et un reçu est généré)
          </label>

          <div className="mt-4 rounded-xl border border-primary/25 bg-card p-3 text-sm">
            <div className="flex justify-between"><span>Jours sélectionnés</span><span data-testid="record-payment-count">{chosen.length}</span></div>
            <div className="flex justify-between"><span>Cotisations</span><span>{fcfa(contributions)}</span></div>
            <div className="flex justify-between"><span>Pénalités</span><span>{fcfa(penalties)}</span></div>
            <div className="mt-2 flex justify-between border-t border-primary/20 pt-2 font-heading text-lg">
              <span>Total</span>
              <span data-testid="record-payment-total">{fcfa(contributions + penalties)}</span>
            </div>
          </div>

          <Button
            className="mt-4 w-full"
            disabled={selected.length === 0 || save.isPending}
            onClick={() => save.mutate()}
            data-testid="record-payment-submit-button"
          >
            {save.isPending ? "Enregistrement…" : "Enregistrer ce paiement"}
          </Button>
        </>
      )}
    </div>
  );
}

function RemindDialog({
  arrear,
  onClose,
}: {
  arrear: ArrearRow | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [message, setMessage] = useState("");

  const send = useMutation({
    mutationFn: () =>
      apiPost<RemindResult>("/arrears/remind", {
        member_id: arrear?.member_id,
        tontine_id: arrear?.tontine_id,
        message: message.trim() || undefined,
      }),
    onSuccess: (r) => {
      toast.success(`Relance envoyée — ${fcfa(r.total_due)} réclamés`);
      setMessage("");
      qc.invalidateQueries();
      onClose();
    },
    onError: (e) => toast.error(detail(e, "Relance impossible")),
  });

  return (
    <Dialog open={Boolean(arrear)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-md" data-testid="remind-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">Relancer {arrear?.member_name}</DialogTitle>
        </DialogHeader>
        {arrear && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {arrear.tontine_name} · {arrear.late_days} jour(s) impayé(s) ·{" "}
              <strong className="text-foreground">{fcfa(arrear.total_due)}</strong> dus, pénalités incluses.
              Le récapitulatif est ajouté automatiquement au message.
            </p>
            <div className="space-y-2">
              <Label htmlFor="remind-message">Message personnalisé (optionnel)</Label>
              <Textarea
                id="remind-message"
                rows={3}
                placeholder="Bonjour, merci de passer régler vos jours avant vendredi."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                data-testid="remind-message-input"
              />
            </div>
            <Button className="w-full" disabled={send.isPending} onClick={() => send.mutate()} data-testid="remind-send-button">
              {send.isPending ? "Envoi…" : "Envoyer la relance"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function HistoricalPayoutDialog({
  position,
  onClose,
}: {
  position: Position | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");

  const save = useMutation({
    mutationFn: () =>
      apiPost<Payout>("/payouts/historical", {
        position_id: position?.id,
        payout_date: date,
        amount: amount ? Number(amount) : undefined,
      }),
    onSuccess: () => {
      toast.success("Prise historique enregistrée");
      setDate("");
      setAmount("");
      qc.invalidateQueries();
      onClose();
    },
    onError: (e) => toast.error(detail(e, "Enregistrement impossible")),
  });

  return (
    <Dialog open={Boolean(position)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-md" data-testid="historical-payout-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">Prise déjà versée</DialogTitle>
        </DialogHeader>
        {position && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Position {position.index} — {position.member_name ?? "membre non attribué"}. À utiliser uniquement
              pour une prise remise <strong className="text-foreground">avant l'arrivée sur la plateforme</strong> :
              elle sera identifiée comme historique, jamais comme une confirmation du jour.
            </p>
            <div className="space-y-2">
              <Label htmlFor="hp-date">Date réelle de la remise</Label>
              <Input id="hp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="historical-payout-date-input" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hp-amount">Montant remis (laisser vide pour le montant de la tontine)</Label>
              <Input id="hp-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="historical-payout-amount-input" />
            </div>
            <Button className="w-full" disabled={!date || save.isPending} onClick={() => save.mutate()} data-testid="historical-payout-save-button">
              {save.isPending ? "Enregistrement…" : "Enregistrer la prise historique"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProofDialog({ paymentId, onClose }: { paymentId: string | null; onClose: () => void }) {
  const proof = useQuery({
    queryKey: ["payment-proof", paymentId],
    queryFn: () => apiGet<PaymentProof>(`/payments/${paymentId}/proof`),
    enabled: Boolean(paymentId),
    retry: false,
  });

  return (
    <Dialog open={Boolean(paymentId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-lg" data-testid="proof-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">Preuve de paiement</DialogTitle>
        </DialogHeader>
        {proof.isLoading && <Empty text="Chargement de la preuve…" />}
        {proof.isError && <Empty text="Preuve indisponible." testId="proof-dialog-error" />}
        {proof.data && (
          <div className="space-y-3">
            <p className="truncate text-xs text-muted-foreground" data-testid="proof-filename">{proof.data.proof_filename}</p>
            {/* Pinch-to-zoom: the image scrolls inside its own box on a phone. */}
            <div className="max-h-[65vh] overflow-auto rounded-xl border border-border/70 bg-muted/30 touch-pan-x touch-pan-y">
              <img src={proof.data.proof_image} alt="Preuve de paiement" className="w-full" data-testid="proof-image" />
            </div>
            <a
              href={proof.data.proof_image}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", className: "w-full" })}
              data-testid="proof-open-full"
            >
              Ouvrir en plein écran
            </a>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportMembersCard({ tontines }: { tontines: Tontine[] }) {
  const qc = useQueryClient();
  const [tontineId, setTontineId] = useState("");
  const [file, setFile] = useState<{ data: string; name: string } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const run = useMutation({
    mutationFn: () =>
      apiPost<ImportResult>("/members/import", {
        tontine_id: tontineId,
        file_base64: file?.data,
        filename: file?.name,
      }),
    onSuccess: (r) => {
      setResult(r);
      setFile(null);
      toast.success(`${r.created} compte(s) créé(s), ${r.enrolled} rattaché(s), ${r.skipped} ignoré(s)`);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Import impossible")),
  });

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-6">
      <h3 className="font-heading text-xl">Importer les membres depuis un fichier Excel</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Colonnes attendues : <strong>Prénom</strong>, <strong>Nom</strong>, <strong>Email</strong>,{" "}
        <strong>Téléphone</strong>. Formats acceptés : .xlsx ou .csv. Les comptes déjà existants sont simplement
        rattachés à la tontine, sans doublon.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="imp-tontine">Tontine de destination</Label>
          <select
            id="imp-tontine"
            className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
            value={tontineId}
            onChange={(e) => setTontineId(e.target.value)}
            data-testid="import-tontine-select"
          >
            <option value="">— Choisir —</option>
            {tontines.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="imp-file">Fichier</Label>
          <Input
            id="imp-file"
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            data-testid="import-file-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const reader = new FileReader();
              reader.onload = () => setFile({ data: String(reader.result), name: f.name });
              reader.readAsDataURL(f);
            }}
          />
        </div>
      </div>
      <Button
        className="mt-4 w-full sm:w-auto"
        disabled={!tontineId || !file || run.isPending}
        onClick={() => run.mutate()}
        data-testid="import-submit-button"
      >
        {run.isPending ? "Import en cours…" : "Importer les membres"}
      </Button>
      {result && (
        <div className="mt-5 space-y-2" data-testid="import-result">
          <p className="text-sm">
            {result.tontine_name} — {result.created} créé(s), {result.enrolled} rattaché(s), {result.skipped} ignoré(s)
          </p>
          {result.rows.map((r) => (
            <div key={r.line} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-xs">
              <span className="font-medium">Ligne {r.line}</span>
              <span>{r.first_name} {r.last_name}</span>
              <span className="text-muted-foreground">{r.email}</span>
              <StatusPill value={r.status} />
              <span className="text-muted-foreground">{r.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MembersPanel({ tontines, isAdmin }: { tontines: Tontine[]; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"direct" | "invite">("direct");
  const [f, setF] = useState({ first_name: "", last_name: "", phone: "", email: "", password: "", tontine_id: "" });
  const [hist, setHist] = useState({ tontine_id: "", member_id: "", up_to_date: new Date().toISOString().slice(0, 10) });
  const [profileMemberId, setProfileMemberId] = useState<string | null>(null);
  const [branchDraft, setBranchDraft] = useState<Record<string, number>>({});
  const [positionDraft, setPositionDraft] = useState<Record<string, { position_id: string; branch_number: number }>>({});
  const [memberDraft, setMemberDraft] = useState({ first_name: "", last_name: "", phone: "", email: "", address: "", extra_info: "" });

  const invitations = useQuery({ queryKey: ["invitations"], queryFn: () => apiGet<Invitation[]>("/invitations"), retry: false });
  const members = useQuery({ queryKey: ["members"], queryFn: () => apiGet<MemberRow[]>("/members"), retry: false });
  const profile = useQuery({
    queryKey: ["member-file", profileMemberId],
    queryFn: () => apiGet<MemberFile>(`/members/${profileMemberId}/file`),
    enabled: Boolean(profileMemberId),
    retry: false,
  });

  useEffect(() => {
    if (profile.data) {
      setMemberDraft({
        first_name: profile.data.first_name,
        last_name: profile.data.last_name,
        phone: profile.data.phone,
        email: profile.data.email,
        address: profile.data.address ?? "",
        extra_info: profile.data.extra_info ?? "",
      });
    }
  }, [profile.data]);

  const updateMember = useMutation({
    mutationFn: () => apiPatch<MemberFile>(`/members/${profileMemberId}`, memberDraft),
    onSuccess: () => { toast.success("Informations du membre mises à jour"); qc.invalidateQueries({ queryKey: ["member-file", profileMemberId] }); qc.invalidateQueries({ queryKey: ["members"] }); },
    onError: (e) => toast.error(detail(e, "Modification impossible")),
  });

  const disableMember = useMutation({
    mutationFn: () => apiPatch<MemberFile>(`/members/${profileMemberId}/status`, { status: "disabled" }),
    onSuccess: () => { toast.success("Compte membre désactivé, historique conservé"); qc.invalidateQueries(); },
    onError: (e) => toast.error(detail(e, "Désactivation impossible")),
  });

  const reactivateMember = useMutation({
    mutationFn: () => apiPatch<MemberFile>(`/members/${profileMemberId}/status`, { status: "active" }),
    onSuccess: () => { toast.success("Compte membre réactivé"); qc.invalidateQueries(); },
    onError: (e) => toast.error(detail(e, "Réactivation impossible")),
  });

  const trashMember = useMutation({
    mutationFn: () => apiPost(`/members/${profileMemberId}/trash`),
    onSuccess: () => { toast.success("Membre placé dans la corbeille"); qc.invalidateQueries(); setProfileMemberId(null); },
    onError: (e) => toast.error(detail(e, "Mise à la corbeille impossible")),
  });

  const updateBranches = useMutation({
    mutationFn: (v: { member_id: string; tontine_id: string; branches: number }) =>
      apiPatch<MemberFile>(`/members/${v.member_id}/tontines/${v.tontine_id}`, { branches: v.branches }),
    onSuccess: () => { toast.success("Branches mises à jour"); qc.invalidateQueries({ queryKey: ["member-file", profileMemberId] }); qc.invalidateQueries(); },
    onError: (e) => toast.error(detail(e, "Modification des branches impossible")),
  });

  const updatePosition = useMutation({
    mutationFn: (v: { member_id: string; position_id: string; branch_number: number }) =>
      apiPatch<MemberFile>(`/members/${v.member_id}/positions`, { position_id: v.position_id, branch_number: v.branch_number }),
    onSuccess: () => { toast.success("Prise mise à jour"); qc.invalidateQueries({ queryKey: ["member-file", profileMemberId] }); qc.invalidateQueries(); },
    onError: (e) => toast.error(detail(e, "Modification de la prise impossible")),
  });

  const reset = () => setF({ first_name: "", last_name: "", phone: "", email: "", password: "", tontine_id: "" });

  const createDirect = useMutation({
    mutationFn: () =>
      apiPost<{ first_name: string; enrolled_in: string | null }>("/members/create", {
        ...f,
        tontine_id: f.tontine_id || undefined,
      }),
    onSuccess: (m) => {
      toast.success(m.enrolled_in ? `Compte créé et ajouté à ${m.enrolled_in}` : "Compte membre créé");
      reset();
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Création impossible")),
  });

  const invite = useMutation({
    mutationFn: () =>
      apiPost<Invitation>("/invitations", {
        first_name: f.first_name,
        last_name: f.last_name,
        phone: f.phone,
        email: f.email,
        tontine_id: f.tontine_id || undefined,
      }),
    onSuccess: async (inv) => {
      const url = `${window.location.origin}${inv.invite_path}`;
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      toast.success("Invitation créée — lien copié");
      reset();
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Invitation impossible")),
  });

  const cancelInvite = useMutation({
    mutationFn: (id: string) => apiPost<Invitation>(`/invitations/${id}/cancel`),
    onSuccess: () => {
      toast.success("Invitation annulée");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Annulation impossible")),
  });

  const enrol = useMutation({
    mutationFn: (v: { member_id: string; tontine_id: string }) => apiPost<{ tontine_name: string }>("/members/enrol", v),
    onSuccess: (r) => {
      toast.success(`Membre ajouté à ${r.tontine_name}`);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Ajout impossible")),
  });

  const bulk = useMutation({
    mutationFn: () => apiPost<{ updated: number }>("/due-dates/bulk-history", { ...hist, status: "paid" }),
    onSuccess: (r) => {
      toast.success(`${r.updated} jour(s) marqué(s) payés (historique)`);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Régularisation impossible")),
  });

  const tontineOptions = (
    <>
      <option value="">— Aucune tontine —</option>
      {tontines.map((t) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </>
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/70 bg-card p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={mode === "direct" ? "default" : "ghost"} onClick={() => setMode("direct")} data-testid="members-mode-direct">
            Créer un compte membre
          </Button>
          <Button size="sm" variant={mode === "invite" ? "default" : "ghost"} onClick={() => setMode("invite")} data-testid="members-mode-invite">
            Inviter par lien
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {mode === "direct"
            ? "Idéal pour une tontine déjà démarrée : vous créez le compte avec un mot de passe provisoire et vous le rattachez immédiatement."
            : "Le membre reçoit un lien et choisit lui-même son mot de passe. Vous ne connaîtrez jamais son mot de passe."}
        </p>
        <form
          className="mt-6 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            (mode === "direct" ? createDirect : invite).mutate();
          }}
        >
          {([["first_name", "Prénom"], ["last_name", "Nom"], ["phone", "Téléphone"], ["email", "Email"]] as const).map(([k, l]) => (
            <div key={k} className="space-y-2">
              <Label htmlFor={`nm-${k}`}>{l}</Label>
              <Input id={`nm-${k}`} required={k !== "phone"} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`new-member-${k}-input`} />
            </div>
          ))}
          {mode === "direct" && (
            <div className="space-y-2">
              <Label htmlFor="nm-password">Mot de passe provisoire</Label>
              <Input id="nm-password" type="password" required minLength={6} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} data-testid="new-member-password-input" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="nm-tontine">Ajouter à une tontine</Label>
            <select
              id="nm-tontine"
              className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
              value={f.tontine_id}
              onChange={(e) => setF({ ...f, tontine_id: e.target.value })}
              data-testid="new-member-tontine-select"
            >
              {tontineOptions}
            </select>
          </div>
          <Button type="submit" className="sm:col-span-2" disabled={createDirect.isPending || invite.isPending} data-testid="new-member-submit-button">
            {mode === "direct" ? "Créer le compte membre" : "Générer le lien d'invitation"}
          </Button>
        </form>
      </div>

      <ImportMembersCard tontines={tontines} />

      <div className="rounded-2xl border border-border/70 bg-card p-6">
        <h3 className="font-heading text-xl">Régulariser un historique de cotisations</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Pour une tontine déjà en cours : marque comme payés tous les jours d'un membre jusqu'à la date choisie.
          L'opération est identifiée comme historique (jamais comme un paiement Wave) et auditée.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="h-tontine">Tontine</Label>
            <select
              id="h-tontine"
              className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
              value={hist.tontine_id}
              onChange={(e) => setHist({ ...hist, tontine_id: e.target.value, member_id: "" })}
              data-testid="history-tontine-select"
            >
              {tontineOptions}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="h-member">Membre</Label>
            <select
              id="h-member"
              className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
              value={hist.member_id}
              onChange={(e) => setHist({ ...hist, member_id: e.target.value })}
              data-testid="history-member-select"
            >
              <option value="">— Choisir —</option>
              {(members.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="h-date">Jusqu'au</Label>
            <Input id="h-date" type="date" value={hist.up_to_date} onChange={(e) => setHist({ ...hist, up_to_date: e.target.value })} data-testid="history-date-input" />
          </div>
        </div>
        <Button
          className="mt-4"
          disabled={!hist.tontine_id || !hist.member_id || bulk.isPending}
          onClick={() => bulk.mutate()}
          data-testid="history-bulk-button"
        >
          Marquer ces jours comme payés
        </Button>
      </div>

      <div className="rounded-2xl border border-border/70 bg-card p-6">
        <h3 className="font-heading text-xl">Invitations</h3>
        <div className="mt-4 space-y-2" data-testid="invitations-list">
          {(invitations.data ?? []).map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 px-4 py-3 text-sm">
              <span className="font-medium">{i.first_name} {i.last_name}</span>
              <span className="text-muted-foreground">{i.email}</span>
              <span className="text-xs text-muted-foreground">{i.tontine_name ?? "sans tontine"}</span>
              <StatusPill value={i.status} />
              <div className="ml-auto flex gap-2">
                <Button
                  size="xs"
                  variant="ghost"
                  data-testid={`invitation-copy-${i.id}`}
                  onClick={() => {
                    const url = `${window.location.origin}${i.invite_path}`;
                    navigator.clipboard?.writeText(url).catch(() => undefined);
                    toast.success("Lien copié");
                  }}
                >
                  Copier le lien
                </Button>
                {i.status === "sent" && (
                  <Button size="xs" variant="ghost" onClick={() => cancelInvite.mutate(i.id)} data-testid={`invitation-cancel-${i.id}`}>
                    Annuler
                  </Button>
                )}
              </div>
            </div>
          ))}
          {(invitations.data ?? []).length === 0 && <Empty text="Aucune invitation envoyée." testId="invitations-empty" />}
        </div>
      </div>

      <div className="rounded-2xl border border-border/70 bg-card p-6">
        <h3 className="font-heading text-xl">Membres</h3>
        <div className="mt-4 space-y-2" data-testid="staff-members-list">
          {(members.data ?? []).map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 px-4 py-3 text-sm">
              <span className="font-medium">{m.first_name} {m.last_name}</span>
              <span className="text-muted-foreground">{m.email}</span>
              <span className="text-xs text-muted-foreground">{m.tontine_count} tontine(s)</span>
              <StatusPill value={m.status} />
              <span className="text-xs">Identité : {label(m.identity_status)}</span>
              <div className="ml-auto flex items-center gap-2">
                  <Button size="xs" variant="outline" onClick={() => setProfileMemberId(m.id)} data-testid={`member-profile-${m.id}`}>
                    Gérer branches et prises
                  </Button>
                <select
                  className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
                  defaultValue=""
                  data-testid={`enrol-select-${m.id}`}
                  onChange={(e) => {
                    if (e.target.value) enrol.mutate({ member_id: m.id, tontine_id: e.target.value });
                    e.target.value = "";
                  }}
                >
                  <option value="">Ajouter à une tontine…</option>
                  {tontines.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
          {(members.data ?? []).length === 0 && <Empty text="Aucun membre dans cette gérance." testId="staff-members-empty" />}
        </div>
      </div>

      <Dialog open={Boolean(profileMemberId)} onOpenChange={(open) => !open && setProfileMemberId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Fiche membre : {profile.data ? `${profile.data.first_name} ${profile.data.last_name}` : "chargement"}</DialogTitle>
          </DialogHeader>
          {profile.isLoading && <p className="text-sm text-muted-foreground">Chargement de la fiche…</p>}
          {profile.data && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Même compte membre, plusieurs branches et prises possibles dans une même tontine.</p>
              <div className="grid gap-3 rounded-xl border border-border/70 p-4 sm:grid-cols-2">
                {([['first_name', 'Prénom'], ['last_name', 'Nom'], ['phone', 'Téléphone'], ['email', 'Email'], ['address', 'Adresse'], ['extra_info', 'Informations complémentaires']] as const).map(([key, text]) => (
                  <div key={key} className="space-y-1">
                    <Label htmlFor={`member-edit-${key}`}>{text}</Label>
                    <Input
                      id={`member-edit-${key}`}
                      value={memberDraft[key]}
                      onChange={(e) => setMemberDraft({ ...memberDraft, [key]: e.target.value })}
                    />
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                  <Button size="sm" onClick={() => updateMember.mutate()} disabled={updateMember.isPending}>Enregistrer les informations</Button>
                  {profile.data.status === "disabled" ? (
                    <Button size="sm" onClick={() => reactivateMember.mutate()} disabled={reactivateMember.isPending}>Réactiver</Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => disableMember.mutate()} disabled={disableMember.isPending}>Désactiver</Button>
                  )}
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={trashMember.isPending || profile.data.status === "trashed"}
                      onClick={() => {
                        if (window.confirm("Placer ce membre dans la corbeille ? Ses données seront conservées et il ne pourra plus se connecter.")) {
                          trashMember.mutate();
                        }
                      }}
                    >
                      Mettre à la corbeille
                    </Button>
                  )}
                </div>
              </div>
              {profile.data.tontines.map((line) => {
                const branchKey = `${profile.data!.id}:${line.tontine_id}`;
                const positionState = positionDraft[branchKey] ?? {
                  position_id: line.available_positions.find((p) => p.status === "open")?.id ?? "",
                  branch_number: 1,
                };
                return (
                  <div key={line.tontine_id} className="space-y-3 rounded-xl border border-border/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{line.tontine_name}</p>
                        <p className="text-xs text-muted-foreground">{line.branches} branche(s) · {fcfa(line.daily_amount)} / jour / branche</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          className="w-20"
                          type="number"
                          min={1}
                          value={String(branchDraft[branchKey] ?? line.branches)}
                          onChange={(e) => setBranchDraft({ ...branchDraft, [branchKey]: Number(e.target.value) })}
                          aria-label={`Nombre de branches pour ${line.tontine_name}`}
                        />
                        <Button size="xs" onClick={() => updateBranches.mutate({ member_id: profile.data!.id, tontine_id: line.tontine_id, branches: branchDraft[branchKey] ?? line.branches })}>
                          Enregistrer branches
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {line.positions.map((position) => (
                        <div key={position.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                          <span>Prise {position.position_index} · {position.payout_date}</span>
                          <select
                            className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
                            value={String(position.branch_number)}
                            onChange={(e) => updatePosition.mutate({ member_id: profile.data!.id, position_id: position.id, branch_number: Number(e.target.value) })}
                          >
                            {Array.from({ length: line.branches }, (_, i) => i + 1).map((branch) => <option key={branch} value={branch}>Branche {branch}</option>)}
                          </select>
                          <span className="text-xs text-muted-foreground">{position.status}</span>
                        </div>
                      ))}
                      {line.positions.length === 0 && <p className="text-sm text-muted-foreground">Aucune prise attribuée.</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                      <span className="text-sm font-medium">Ajouter une prise</span>
                      <select
                        className="h-8 min-w-44 rounded-lg border border-input bg-background px-2 text-xs"
                        value={positionState.position_id}
                        onChange={(e) => setPositionDraft({ ...positionDraft, [branchKey]: { ...positionState, position_id: e.target.value } })}
                      >
                        <option value="">Choisir une prise libre…</option>
                        {line.available_positions.filter((p) => p.status === "open").map((p) => <option key={p.id} value={p.id}>Prise {p.position_index} · {p.payout_date}</option>)}
                      </select>
                      <select
                        className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
                        value={String(positionState.branch_number)}
                        onChange={(e) => setPositionDraft({ ...positionDraft, [branchKey]: { ...positionState, branch_number: Number(e.target.value) } })}
                      >
                        {Array.from({ length: line.branches }, (_, i) => i + 1).map((branch) => <option key={branch} value={branch}>Branche {branch}</option>)}
                      </select>
                      <Button
                        size="xs"
                        disabled={!positionState.position_id || updatePosition.isPending}
                        onClick={() => updatePosition.mutate({ member_id: profile.data!.id, position_id: positionState.position_id, branch_number: positionState.branch_number })}
                      >
                        Ajouter la prise
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TrashPanel({ members }: { members: TrashMember[] }) {
  const qc = useQueryClient();
  const restore = useMutation({
    mutationFn: (id: string) => apiPost(`/members/${id}/restore`),
    onSuccess: () => { toast.success("Membre restauré"); qc.invalidateQueries(); },
    onError: (e) => toast.error(detail(e, "Restauration impossible")),
  });
  const permanentDelete = useMutation({
    mutationFn: (id: string) => apiDelete(`/members/${id}/permanent`),
    onSuccess: () => { toast.success("Membre supprimé définitivement"); qc.invalidateQueries(); },
    onError: (e) => toast.error(detail(e, "Suppression définitive impossible")),
  });

  return (
    <div className="space-y-3" data-testid="member-trash-list">
      <p className="text-sm text-muted-foreground">Les membres de cette liste ne peuvent plus se connecter. Leurs branches, prises et historiques sont conservés jusqu’à une suppression définitive.</p>
      {members.map((member) => (
        <div key={member.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 text-sm">
          <div>
            <p className="font-medium">{member.first_name} {member.last_name}</p>
            <p className="text-xs text-muted-foreground">{member.email} · {member.tontine_count} tontine(s)</p>
          </div>
          <span className="text-xs text-muted-foreground">Mis à la corbeille {member.trashed_at ? new Date(member.trashed_at).toLocaleDateString("fr-FR") : ""}</span>
          <div className="ml-auto flex gap-2">
            <Button size="xs" onClick={() => restore.mutate(member.id)} disabled={restore.isPending}>Restaurer</Button>
            <Button
              size="xs"
              variant="destructive"
              onClick={() => {
                if (window.confirm("Supprimer définitivement ce membre et toutes ses données ? Cette action est irréversible.")) {
                  permanentDelete.mutate(member.id);
                }
              }}
              disabled={permanentDelete.isPending}
            >
              Supprimer définitivement
            </Button>
          </div>
        </div>
      ))}
      {members.length === 0 && <Empty text="La corbeille est vide." testId="member-trash-empty" />}
    </div>
  );
}

const DUE_FILTERS: [string, string][] = [
  ["all", "Tous"],
  ["paid", "À jour"],
  ["late", "En retard"],
  ["processing", "Paiements à vérifier"],
  ["penalties", "Pénalités"],
  ["today", "Aujourd'hui"],
  ["upcoming", "À venir"],
];

function matchesDueFilter(d: DueDate, filter: string, today: string): boolean {
  switch (filter) {
    case "paid":
      return d.status === "paid";
    case "late":
      return d.display_status === "late";
    case "processing":
      return d.status === "processing";
    case "penalties":
      return d.penalty > 0;
    case "today":
      return d.date === today;
    case "upcoming":
      return d.date > today;
    default:
      return true;
  }
}

export default function StaffSpace({ mode }: { mode: "admin" | "manager" }) {
  const { data: me, isLoading } = useMe();
  const qc = useQueryClient();
  const [tab, setTab] = useState("dashboard");
  const [dueFilter, setDueFilter] = useState("all");
  const [proofId, setProofId] = useState<string | null>(null);
  const [remindTarget, setRemindTarget] = useState<ArrearRow | null>(null);
  const [exporting, setExporting] = useState(false);
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
  const arrears = useQuery({ queryKey: ["arrears"], queryFn: () => apiGet<ArrearRow[]>("/arrears"), retry: false });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => apiGet<Notification[]>("/notifications"), retry: false });
  const trashMembers = useQuery({ queryKey: ["members", "trash"], queryFn: () => apiGet<TrashMember[]>("/members/trash"), enabled: isAdmin, retry: false });

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
  const todayIso = new Date().toISOString().slice(0, 10);
  const filteredDues = (dues.data ?? []).filter((d) => matchesDueFilter(d, dueFilter, todayIso));

  return (
    <PublicLayout hasBottomBar>
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-5 md:py-10">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">{isAdmin ? "Administration" : "Gérance"}</p>
        <h1 className="font-heading text-3xl md:text-4xl" data-testid="staff-space-title">
          {isAdmin ? "Administrateur principal" : g?.name ?? "Ma gérance"}
        </h1>

        <Tabs value={tab} onValueChange={setTab} className="mt-6 min-w-0 md:mt-8">
          <TabsList variant="line" className={scrollTabs}>
            <TabsTrigger value="dashboard" data-testid="tab-dashboard">Tableau de bord</TabsTrigger>
            <TabsTrigger value="ma-gerance" data-testid="tab-ma-gerance">Ma gérance</TabsTrigger>
            <TabsTrigger value="membres" data-testid="tab-membres">Membres &amp; invitations</TabsTrigger>
                        {isAdmin && <TabsTrigger value="corbeille" data-testid="tab-corbeille">Corbeille ({trashMembers.data?.length ?? 0})</TabsTrigger>}
            {isAdmin && <TabsTrigger value="supervision" data-testid="tab-supervision">Supervision des gérances</TabsTrigger>}
            {isAdmin && <TabsTrigger value="gerants" data-testid="tab-gerants">Gérants</TabsTrigger>}
            <TabsTrigger value="demandes" data-testid="tab-demandes">Demandes d'adhésion</TabsTrigger>
            <TabsTrigger value="paiements" data-testid="tab-paiements">Paiements</TabsTrigger>
            <TabsTrigger value="cotisations" data-testid="tab-cotisations">Cotisations</TabsTrigger>
            <TabsTrigger value="retards" data-testid="tab-retards">Retards</TabsTrigger>
            <TabsTrigger value="prises" data-testid="tab-prises">Prises</TabsTrigger>
            <TabsTrigger value="notifications" data-testid="tab-notifications">Notifications</TabsTrigger>
            <TabsTrigger value="audit" data-testid="tab-audit">Historique &amp; audit</TabsTrigger>
            <TabsTrigger value="parametres" data-testid="tab-parametres">⚙️ Paramètres</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="mt-6 space-y-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat title="Tontines (ma gérance)" value={String(g?.tontine_count ?? 0)} testId="stat-tontines" />
              <Stat title="Membres" value={String(g?.member_count ?? 0)} testId="stat-members" />
              <Stat title="Total encaissé" value={fcfa(g?.total_paid ?? 0)} testId="stat-paid" />
              <Stat title="Paiements à vérifier" value={String(pendingPayments.length)} testId="stat-pending-payments" />
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

          <TabsContent value="membres" className="mt-6">
            <MembersPanel tontines={myTontines.data ?? []} isAdmin={isAdmin} />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="corbeille" className="mt-6">
              <TrashPanel members={trashMembers.data ?? []} />
            </TabsContent>
          )}

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
              <div key={r.id} className="rounded-xl border border-border/70 bg-card px-4 py-3 text-sm" data-testid={`request-row-${r.id}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{r.member_name}</span>
                  <StatusPill value={r.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.tontine_name} · {r.gerance_name} · {r.branches} branche(s) · {fcfa(r.daily_total)}/jour
                </p>
                {r.status === "pending" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" className="flex-1 sm:flex-none" onClick={() => decideRequest.mutate({ id: r.id, action: "accept" })} data-testid={`request-accept-${r.id}`}>Accepter</Button>
                    <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => decideRequest.mutate({ id: r.id, action: "reject" })} data-testid={`request-reject-${r.id}`}>Refuser</Button>
                  </div>
                )}
              </div>
            ))}
            {(requests.data ?? []).length === 0 && <Empty text="Aucune demande d'adhésion." testId="staff-requests-empty" />}
          </TabsContent>

          <TabsContent value="paiements" className="mt-6 space-y-2" data-testid="staff-payments-list">
            {(payments.data ?? []).map((p) => (
              <div key={p.id} className="rounded-xl border border-border/70 bg-card px-4 py-3 text-sm" data-testid={`payment-row-${p.id}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{p.member_name}</span>
                  <span>{fcfa(p.amount)}</span>
                  <StatusPill value={p.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{p.tontine_name} · {p.gerance_name} · {p.days.length} jour(s)</p>
                {p.source && p.source.startsWith("saisie") && (
                  <p className="mt-0.5 text-xs text-primary" data-testid={`payment-source-${p.id}`}>
                    Saisie enregistrée par {byLabel(p.source)}
                    {p.note ? ` — ${p.note}` : ""}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="flex-1 sm:flex-none"
                    onClick={() => setProofId(p.id)}
                    data-testid={`payment-proof-view-${p.id}`}
                  >
                    Voir la preuve
                  </Button>
                  {p.status === "pending" && (
                    <>
                      <Button size="sm" className="flex-1 sm:flex-none" onClick={() => decidePayment.mutate({ id: p.id, action: "validate" })} data-testid={`payment-validate-${p.id}`}>Valider le paiement</Button>
                      <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => decidePayment.mutate({ id: p.id, action: "reject" })} data-testid={`payment-reject-${p.id}`}>Rejeter</Button>
                    </>
                  )}
                  {p.status === "validated" && (
                    <a
                      href={`/api/payments/${p.id}/receipt.pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonVariants({ size: "sm", variant: "outline" })}
                      data-testid={`payment-receipt-pdf-${p.id}`}
                    >
                      Reçu PDF{p.receipt_number ? ` — ${p.receipt_number}` : ""}
                    </a>
                  )}
                </div>
              </div>
            ))}
            {(payments.data ?? []).length === 0 && <Empty text="Aucun paiement." testId="staff-payments-empty" />}
          </TabsContent>

          <TabsContent value="cotisations" className="mt-6 space-y-4" data-testid="staff-dues-list">
            <RecordMemberPaymentCard tontines={myTontines.data ?? []} />
            <div className="flex flex-nowrap gap-2 overflow-x-auto no-scrollbar pb-1 md:flex-wrap" data-testid="due-filters">
              {DUE_FILTERS.map(([key, text]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={dueFilter === key ? "default" : "outline"}
                  className="shrink-0"
                  onClick={() => setDueFilter(key)}
                  data-testid={`due-filter-${key}`}
                >
                  {text}
                </Button>
              ))}
            </div>
            {filteredDues.slice(0, 200).map((d) => (
              <div key={d.id} className="rounded-xl border border-border/70 bg-card px-4 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{d.member_name}</span>
                  <span>{d.date}</span>
                  <span className="text-muted-foreground">avant {d.deadline_time}</span>
                  <span>{fcfa(d.amount)}</span>
                  <StatusPill value={d.display_status} />
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="truncate">{d.tontine_name}</span>
                  {d.penalty > 0 && <span className="text-red-700">+{fcfa(d.penalty)} pénalité</span>}
                </p>
              </div>
            ))}
            {filteredDues.length === 0 && (
              <Empty
                text={(dues.data ?? []).length === 0 ? "Aucune échéance enregistrée." : "Aucune échéance pour ce filtre."}
                testId="staff-dues-empty"
              />
            )}
          </TabsContent>

          <TabsContent value="retards" className="mt-6 space-y-2" data-testid="staff-arrears-list">
            {(arrears.data ?? []).length > 0 && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat
                  title="Membres en retard"
                  value={String(new Set((arrears.data ?? []).map((a) => a.member_id)).size)}
                  testId="stat-arrears-members"
                />
                <Stat
                  title="Total dû"
                  value={fcfa((arrears.data ?? []).reduce((s, a) => s + a.total_due, 0))}
                  testId="stat-arrears-total"
                />
                <Stat
                  title="Dont pénalités"
                  value={fcfa((arrears.data ?? []).reduce((s, a) => s + a.penalties, 0))}
                  testId="stat-arrears-penalties"
                />
                <Stat
                  title="Jours impayés"
                  value={String((arrears.data ?? []).reduce((s, a) => s + a.late_days, 0))}
                  testId="stat-arrears-days"
                />
              </div>
            )}
            {(arrears.data ?? []).length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={exporting}
                  data-testid="arrears-export-button"
                  onClick={async () => {
                    setExporting(true);
                    try {
                      const file = await apiGet<ArrearsExport>("/arrears/export");
                      const link = document.createElement("a");
                      link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${file.content_base64}`;
                      link.download = file.filename;
                      link.click();
                      toast.success(`Export Excel prêt — ${file.rows} ligne(s)`);
                    } catch (e) {
                      toast.error(detail(e, "Export impossible"));
                    } finally {
                      setExporting(false);
                    }
                  }}
                >
                  {exporting ? "Export…" : "Exporter en Excel"}
                </Button>
              </div>
            )}
            {(arrears.data ?? []).map((a, i) => (
              <div
                key={`${a.member_id}-${a.tontine_id}`}
                className="rounded-xl border border-border/70 bg-card px-4 py-3 text-sm"
                data-testid={`arrear-row-${a.member_id}-${a.tontine_id}`}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-heading text-base text-muted-foreground">#{i + 1}</span>
                  <span className="font-medium">{a.member_name}</span>
                  <span className="ml-auto font-heading text-lg text-primary" data-testid={`arrear-total-${a.member_id}-${a.tontine_id}`}>
                    {fcfa(a.total_due)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {a.tontine_name} · {a.gerance_name} · {a.member_phone}
                </p>
                <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
                  <span>{a.late_days} jour(s) impayé(s) : {fcfa(a.late_amount)}</span>
                  <span className="text-red-700">pénalités {fcfa(a.penalties)}</span>
                  <span className="text-muted-foreground">le plus ancien : {a.oldest_unpaid}</span>
                  <span className="text-muted-foreground">{a.paid_days}/{a.total_days} jours payés</span>
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3 w-full sm:w-auto"
                  onClick={() => setRemindTarget(a)}
                  data-testid={`arrear-remind-${a.member_id}-${a.tontine_id}`}
                >
                  Relancer ce membre
                </Button>
              </div>
            ))}
            {(arrears.data ?? []).length === 0 && (
              <Empty text="Aucun membre en retard — tout le monde est à jour." testId="staff-arrears-empty" />
            )}
          </TabsContent>

          <TabsContent value="prises" className="mt-6 space-y-2" data-testid="staff-payouts-list">
            {(payouts.data ?? []).map((p) => (
              <div key={p.id} className="rounded-xl border border-border/70 bg-card px-4 py-3 text-sm">
                <p className="font-medium">{p.member_name} — {fcfa(p.amount)}</p>
                <p className="text-muted-foreground">{p.tontine_name} · {p.gerance_name} · position {p.position_index} · {p.payout_date} · confirmé par {p.confirmed_by_name}</p>
                {p.source !== "confirmation" && (
                  <p className="mt-1 text-xs text-primary" data-testid={`payout-source-${p.id}`}>
                    Historique enregistré par {byLabel(p.source)}
                  </p>
                )}
                <a
                  href={`/api/payouts/${p.id}/receipt.pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className={`mt-3 ${buttonVariants({ size: "sm", variant: "outline" })}`}
                  data-testid={`payout-receipt-pdf-${p.id}`}
                >
                  Imprimer le reçu PDF{p.receipt_number ? ` — ${p.receipt_number}` : ""}
                </a>
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

          <TabsContent value="parametres" className="mt-6">
            <SettingsPanel tontines={myTontines.data ?? []} isAdmin={isAdmin} />
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
      <ProofDialog paymentId={proofId} onClose={() => setProofId(null)} />
      <RemindDialog arrear={remindTarget} onClose={() => setRemindTarget(null)} />
      <BottomBar
        value={tab}
        onChange={setTab}
        items={[
          { value: "dashboard", text: "Accueil", icon: LayoutDashboard },
          { value: "ma-gerance", text: "Tontines", icon: Landmark },
          { value: "membres", text: "Membres", icon: UserPlus },
                    ...(isAdmin ? [{ value: "corbeille", text: "Corbeille", icon: Trash2, badge: trashMembers.data?.length ?? 0 }] : []),
          { value: "paiements", text: "Paiements", icon: Wallet, badge: pendingPayments.length },
        ]}
      />
    </PublicLayout>
  );
}
