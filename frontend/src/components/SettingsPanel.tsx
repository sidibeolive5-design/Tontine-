import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Empty, StatusPill } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, ApiError } from "@/lib/api";
import type { FinanceRules, GeranceMethod, PlatformSettings, Tontine } from "@/lib/types";

const detail = (e: unknown, fallback: string) =>
  (e instanceof ApiError ? (e.body as { detail?: string } | null)?.detail : null) ?? fallback;

function PlatformCard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings", "platform"],
    queryFn: () => apiGet<PlatformSettings>("/settings/platform"),
    retry: false,
  });
  const [form, setForm] = useState<PlatformSettings | null>(null);
  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  const save = useMutation({
    mutationFn: () => apiPut<PlatformSettings>("/settings/platform", form),
    onSuccess: () => {
      toast.success("Paramètres généraux enregistrés");
      qc.invalidateQueries({ queryKey: ["settings", "platform"] });
    },
    onError: (e) => toast.error(detail(e, "Enregistrement impossible")),
  });

  if (!form) return <Empty text="Chargement des paramètres…" />;
  const set = (k: keyof PlatformSettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const fields: [keyof PlatformSettings, string][] = [
    ["name", "Nom de la plateforme"],
    ["slogan", "Slogan"],
    ["whatsapp", "Numéro WhatsApp"],
    ["phone", "Numéro de téléphone"],
    ["email", "Email"],
    ["address", "Adresse"],
    ["currency", "Devise"],
    ["language", "Langue"],
  ];

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-5 md:p-6">
      <h3 className="font-heading text-xl">Paramètres généraux</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Ces valeurs sont enregistrées en base et s'appliquent sans modifier le code.
      </p>
      <form
        className="mt-5 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {fields.map(([k, l]) => (
          <div key={k} className="space-y-2">
            <Label htmlFor={`ps-${k}`}>{l}</Label>
            <Input id={`ps-${k}`} value={String(form[k] ?? "")} onChange={set(k)} data-testid={`platform-${k}-input`} />
          </div>
        ))}
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="ps-contact">Informations de contact</Label>
          <Textarea id="ps-contact" value={form.contact_note} onChange={set("contact_note")} data-testid="platform-contact-input" />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="ps-logo">Logo</Label>
          <Input
            id="ps-logo"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            data-testid="platform-logo-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setForm({ ...form, logo: String(reader.result) });
              reader.readAsDataURL(file);
            }}
          />
          {form.logo && <img src={form.logo} alt="logo" className="mt-2 h-12 w-auto" data-testid="platform-logo-preview" />}
        </div>
        <Button type="submit" className="sm:col-span-2" disabled={save.isPending} data-testid="platform-save-button">
          {save.isPending ? "Enregistrement…" : "Enregistrer les paramètres généraux"}
        </Button>
      </form>
    </div>
  );
}

function FinanceCard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings", "finance"],
    queryFn: () => apiGet<FinanceRules>("/settings/finance"),
    retry: false,
  });
  const [form, setForm] = useState<FinanceRules | null>(null);
  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  const save = useMutation({
    mutationFn: () => apiPut<FinanceRules>("/settings/finance", form),
    onSuccess: () => {
      toast.success("Règles financières enregistrées");
      qc.invalidateQueries({ queryKey: ["settings", "finance"] });
    },
    onError: (e) => toast.error(detail(e, "Enregistrement impossible")),
  });

  if (!form) return <Empty text="Chargement des règles financières…" />;

  const numbers: [keyof FinanceRules, string][] = [
    ["penalty_per_day", "Pénalité de retard (FCFA par jour impayé)"],
    ["grace_days", "Jours de tolérance avant pénalité (0 = dès le lendemain)"],
    ["replacement_after_days", "Délai avant remplacement d'un membre (jours)"],
    ["advance_max_days", "Nombre maximum de jours payables à l'avance"],
  ];

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-5 md:p-6">
      <h3 className="font-heading text-xl">Règles financières</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Valeurs par défaut de votre gérance. Chaque tontine peut ensuite définir sa propre heure limite,
        sa pénalité et son mode de calcul.
      </p>
      <form
        className="mt-5 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="fr-deadline">Heure limite de paiement</Label>
          <Input
            id="fr-deadline"
            type="time"
            value={form.deadline_time}
            onChange={(e) => setForm({ ...form, deadline_time: e.target.value })}
            data-testid="finance-deadline-input"
          />
        </div>
        {numbers.map(([k, l]) => (
          <div key={k} className="space-y-2">
            <Label htmlFor={`fr-${k}`}>{l}</Label>
            <Input
              id={`fr-${k}`}
              type="number"
              min={0}
              value={String(form[k])}
              onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })}
              data-testid={`finance-${k}-input`}
            />
          </div>
        ))}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <Checkbox
            checked={form.allow_advance}
            onCheckedChange={(v) => setForm({ ...form, allow_advance: Boolean(v) })}
            data-testid="finance-advance-checkbox"
          />
          Autoriser le paiement de plusieurs jours à l'avance
        </label>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="fr-fees">Frais éventuels</Label>
          <Textarea id="fr-fees" value={form.fees_note} onChange={(e) => setForm({ ...form, fees_note: e.target.value })} data-testid="finance-fees-input" />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="fr-refund">Règles de remboursement</Label>
          <Textarea id="fr-refund" value={form.refund_note} onChange={(e) => setForm({ ...form, refund_note: e.target.value })} data-testid="finance-refund-input" />
        </div>
        <Button type="submit" className="sm:col-span-2" disabled={save.isPending} data-testid="finance-save-button">
          {save.isPending ? "Enregistrement…" : "Enregistrer les règles financières"}
        </Button>
      </form>
    </div>
  );
}

function MethodsCard({ tontines }: { tontines: Tontine[] }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["payment-methods", "manage"],
    queryFn: () => apiGet<GeranceMethod[]>("/payment-methods/manage"),
    retry: false,
  });
  const [draft, setDraft] = useState({
    name: "Wave", code: "wave", number: "", holder: "", icon: "🌊", instructions: "", sort_order: 1,
  });

  const create = useMutation({
    mutationFn: () => apiPost<GeranceMethod>("/payment-methods/manage", { ...draft, active: true }),
    onSuccess: () => {
      toast.success("Moyen de paiement ajouté");
      setDraft({ ...draft, name: "", code: "", number: "", holder: "" });
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Ajout impossible")),
  });

  const patch = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) =>
      apiPatch<GeranceMethod>(`/payment-methods/manage/${v.id}`, v.body),
    onSuccess: () => {
      toast.success("Moyen de paiement mis à jour");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Modification impossible")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/payment-methods/manage/${id}`),
    onSuccess: () => {
      toast.success("Moyen de paiement supprimé — les anciennes transactions sont conservées");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Suppression impossible")),
  });

  const setTontineMethods = useMutation({
    mutationFn: (v: { tontineId: string; ids: string[] }) =>
      apiPut<string[]>(`/tontines/${v.tontineId}/payment-methods`, { payment_method_ids: v.ids }),
    onSuccess: () => {
      toast.success("Moyens de paiement de la tontine mis à jour");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(detail(e, "Modification impossible")),
  });

  const methods = data ?? [];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/70 bg-card p-5 md:p-6">
        <h3 className="font-heading text-xl">Moyens de paiement de ma gérance</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Wave, Orange Money, MTN, Moov ou tout autre moyen. Un moyen désactivé disparaît des nouveaux
          paiements mais les transactions passées restent intactes.
        </p>
        <div className="mt-4 space-y-2" data-testid="methods-list">
          {methods.map((m) => (
            <div key={m.id} className="rounded-xl border border-border/60 px-4 py-3 text-sm" data-testid={`method-row-${m.code}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{m.icon} {m.name}</span>
                <StatusPill value={m.active ? "active" : "suspended"} />
                <span className="text-xs text-muted-foreground">{m.number || "numéro non renseigné"}{m.holder ? ` · ${m.holder}` : ""}</span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Input
                  defaultValue={m.number}
                  placeholder="Numéro"
                  data-testid={`method-number-input-${m.code}`}
                  onBlur={(e) => e.target.value !== m.number && patch.mutate({ id: m.id, body: { number: e.target.value } })}
                />
                <Input
                  defaultValue={m.holder}
                  placeholder="Nom du titulaire"
                  data-testid={`method-holder-input-${m.code}`}
                  onBlur={(e) => e.target.value !== m.holder && patch.mutate({ id: m.id, body: { holder: e.target.value } })}
                />
                <Input
                  defaultValue={m.instructions}
                  placeholder="Instructions de paiement"
                  className="sm:col-span-2"
                  data-testid={`method-instructions-input-${m.code}`}
                  onBlur={(e) => e.target.value !== m.instructions && patch.mutate({ id: m.id, body: { instructions: e.target.value } })}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => patch.mutate({ id: m.id, body: { active: !m.active } })}
                  data-testid={`method-toggle-${m.code}`}
                >
                  {m.active ? "Désactiver" : "Activer"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(m.id)} data-testid={`method-delete-${m.code}`}>
                  Supprimer
                </Button>
              </div>
            </div>
          ))}
          {methods.length === 0 && <Empty text="Aucun moyen de paiement configuré." testId="methods-empty" />}
        </div>

        <form
          className="mt-6 grid gap-4 border-t border-border/60 pt-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="nm-name">Nom</Label>
            <Input id="nm-name" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="method-name-input" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nm-code">Code court (wave, orange, mtn, moov…)</Label>
            <Input id="nm-code" required value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} data-testid="method-code-input" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nm-number">Numéro</Label>
            <Input id="nm-number" value={draft.number} onChange={(e) => setDraft({ ...draft, number: e.target.value })} data-testid="method-new-number-input" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nm-holder">Nom du titulaire</Label>
            <Input id="nm-holder" value={draft.holder} onChange={(e) => setDraft({ ...draft, holder: e.target.value })} data-testid="method-new-holder-input" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nm-icon">Icône</Label>
            <Input id="nm-icon" value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} data-testid="method-icon-input" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nm-order">Ordre d'affichage</Label>
            <Input id="nm-order" type="number" value={String(draft.sort_order)} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })} data-testid="method-order-input" />
          </div>
          <Button type="submit" className="sm:col-span-2" disabled={create.isPending} data-testid="method-create-button">
            {create.isPending ? "Ajout…" : "Ajouter ce moyen de paiement"}
          </Button>
        </form>
      </div>

      <div className="rounded-2xl border border-border/70 bg-card p-5 md:p-6">
        <h3 className="font-heading text-xl">Moyens de paiement par tontine</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Le membre ne verra que les moyens cochés pour la tontine concernée. Aucun moyen coché = tous les
          moyens actifs de la gérance.
        </p>
        <div className="mt-4 space-y-3" data-testid="tontine-methods-list">
          {tontines.map((t) => (
            <div key={t.id} className="rounded-xl border border-border/60 px-4 py-3">
              <p className="text-sm font-medium">{t.name}</p>
              <div className="mt-2 flex flex-wrap gap-3">
                {methods.map((m) => {
                  const checked = t.payment_method_ids.includes(m.id);
                  return (
                    <label key={m.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={checked}
                        data-testid={`tontine-method-${t.id}-${m.code}`}
                        onCheckedChange={(v) =>
                          setTontineMethods.mutate({
                            tontineId: t.id,
                            ids: v
                              ? [...t.payment_method_ids, m.id]
                              : t.payment_method_ids.filter((x) => x !== m.id),
                          })
                        }
                      />
                      {m.icon} {m.name}
                    </label>
                  );
                })}
                {methods.length === 0 && <span className="text-sm text-muted-foreground">Ajoutez d'abord un moyen de paiement.</span>}
              </div>
            </div>
          ))}
          {tontines.length === 0 && <Empty text="Aucune tontine dans cette gérance." />}
        </div>
      </div>
    </div>
  );
}

export default function SettingsPanel({ tontines, isAdmin }: { tontines: Tontine[]; isAdmin: boolean }) {
  return (
    <div className="space-y-6">
      {isAdmin && <PlatformCard />}
      <FinanceCard />
      <MethodsCard tontines={tontines} />
    </div>
  );
}
