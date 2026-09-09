import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PublicLayout, Brand, Empty } from "@/components/Shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { PublicInvitation, User } from "@/lib/types";

const detail = (e: unknown, fallback: string) =>
  (e instanceof ApiError ? (e.body as { detail?: string } | null)?.detail : null) ?? fallback;

export default function InvitationPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const { beginSession } = useSession();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [phone, setPhone] = useState("");

  const invitation = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => apiGet<PublicInvitation>(`/invitations/token/${token}`),
    enabled: Boolean(token),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => apiPost<User>(`/invitations/token/${token}/accept`, { password, phone: phone || undefined }),
    onSuccess: async (user) => {
      await beginSession(user);
      toast.success("Compte activé — bienvenue !");
      navigate("/espace-membre?onboarding=1");
    },
    onError: (e) => toast.error(detail(e, "Activation impossible")),
  });

  const inv = invitation.data;

  return (
    <PublicLayout>
      <div className="mx-auto w-full max-w-md px-5 py-16">
        <div className="rounded-3xl border border-border/70 bg-card p-8 shadow-xl shadow-primary/5">
          <Brand compact />
          <h1 className="mt-6 font-heading text-3xl">Votre invitation</h1>

          {invitation.isLoading && <div className="mt-6"><Empty text="Chargement de l'invitation…" /></div>}

          {!invitation.isLoading && !inv && (
            <div className="mt-4" data-testid="invitation-invalid">
              <p className="text-muted-foreground">Cette invitation est introuvable ou a expiré.</p>
              <Link to="/creer-mon-compte" className={buttonVariants({ className: "mt-6" })}>
                Créer mon compte
              </Link>
            </div>
          )}

          {inv && inv.status !== "sent" && (
            <div className="mt-4" data-testid="invitation-used">
              <p className="text-muted-foreground">Cette invitation a déjà été utilisée ou annulée.</p>
              <Link to="/connexion" className={buttonVariants({ className: "mt-6" })}>Se connecter</Link>
            </div>
          )}

          {inv && inv.status === "sent" && (
            <>
              <p className="mt-2 text-sm text-muted-foreground" data-testid="invitation-summary">
                {inv.first_name} {inv.last_name} — {inv.email}
                <br />
                Gérance : {inv.gerance_name}
                {inv.tontine_name ? ` · Tontine : ${inv.tontine_name}` : ""}
              </p>
              <form
                className="mt-7 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (password !== confirm) {
                    toast.error("Les mots de passe ne correspondent pas");
                    return;
                  }
                  accept.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="inv-phone">Téléphone</Label>
                  <Input id="inv-phone" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="invitation-phone-input" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inv-pass">Choisissez votre mot de passe</Label>
                  <Input id="inv-pass" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="invitation-password-input" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inv-confirm">Confirmation</Label>
                  <Input id="inv-confirm" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="invitation-confirm-input" />
                </div>
                <Button type="submit" className="w-full" disabled={accept.isPending} data-testid="invitation-submit-button">
                  {accept.isPending ? "Activation…" : "Activer mon compte"}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
