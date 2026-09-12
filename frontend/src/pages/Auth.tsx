import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { PublicLayout, Brand } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { User } from "@/lib/types";

function errorText(e: unknown) {
  if (e instanceof ApiError) {
    const body = e.body as { detail?: unknown } | null;
    if (typeof body?.detail === "string") return body.detail;
  }
  return "Une erreur est survenue. Réessayez.";
}

const spaceFor = (role: string) =>
  role === "admin" ? "/administration" : role === "manager" ? "/gerance" : "/espace-membre";

export function Login() {
  const navigate = useNavigate();
  const { beginSession } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () => apiPost<User>("/auth/login", { email, password }),
    onSuccess: async (user) => {
      await beginSession(user);
      toast.success(`Bienvenue ${user.first_name}`);
      navigate(spaceFor(user.role));
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <PublicLayout>
      <div className="mx-auto w-full max-w-md px-4 py-10 md:px-5 md:py-16">
        <div className="rounded-3xl border border-border/70 bg-card p-6 shadow-xl shadow-primary/5 animate-rise md:p-8">
          <Brand compact />
          <h1 className="mt-6 font-heading text-3xl">Connexion</h1>
          <p className="mt-1 text-sm text-muted-foreground">Accédez à votre espace AIDONS-NOUS VIVANTS.</p>
          <form
            className="mt-7 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              login.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email-input" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password-input" />
            </div>
            <Button type="submit" className="w-full" disabled={login.isPending} data-testid="login-submit-button">
              {login.isPending ? "Connexion…" : "Se connecter"}
            </Button>
          </form>
          <div className="mt-5 flex items-center justify-between text-sm">
            <Link to="/mot-de-passe-oublie" className="text-muted-foreground hover:text-primary" data-testid="login-forgot-link">
              Mot de passe oublié ?
            </Link>
            <Link to="/creer-mon-compte" className="text-primary hover:underline" data-testid="login-register-link">
              Créer mon compte
            </Link>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}

export function Register() {
  const navigate = useNavigate();
  const { beginSession } = useSession();
  const [form, setForm] = useState({ first_name: "", last_name: "", phone: "", email: "", password: "", confirm: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const register = useMutation({
    mutationFn: () => {
      const { confirm: _confirm, ...payload } = form;
      return apiPost<User>("/auth/register", payload);
    },
    onSuccess: async (user) => {
      await beginSession(user);
      toast.success("Compte créé — bienvenue !");
      navigate("/espace-membre?onboarding=1");
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <PublicLayout>
      <div className="mx-auto w-full max-w-lg px-4 py-10 md:px-5 md:py-16">
        <div className="rounded-3xl border border-border/70 bg-card p-6 shadow-xl shadow-primary/5 animate-rise md:p-8">
          <Brand compact />
          <h1 className="mt-6 font-heading text-3xl">Créer mon compte</h1>
          <p className="mt-1 text-sm text-muted-foreground">La création du compte est gratuite.</p>
          <form
            className="mt-7 grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (form.password !== form.confirm) {
                toast.error("Les mots de passe ne correspondent pas");
                return;
              }
              register.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="first_name">Prénom</Label>
              <Input id="first_name" required value={form.first_name} onChange={set("first_name")} data-testid="register-firstname-input" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Nom</Label>
              <Input id="last_name" required value={form.last_name} onChange={set("last_name")} data-testid="register-lastname-input" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Téléphone</Label>
              <Input id="phone" required value={form.phone} onChange={set("phone")} data-testid="register-phone-input" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="remail">Email</Label>
              <Input id="remail" type="email" required value={form.email} onChange={set("email")} data-testid="register-email-input" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rpassword">Mot de passe</Label>
              <Input id="rpassword" type="password" required minLength={6} value={form.password} onChange={set("password")} data-testid="register-password-input" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirmation</Label>
              <Input id="confirm" type="password" required value={form.confirm} onChange={set("confirm")} data-testid="register-confirm-input" />
            </div>
            <Button type="submit" className="sm:col-span-2" disabled={register.isPending} data-testid="register-submit-button">
              {register.isPending ? "Création…" : "Créer mon compte"}
            </Button>
          </form>
          <p className="mt-5 text-sm text-muted-foreground">
            Déjà un compte ?{" "}
            <Link to="/connexion" className="text-primary hover:underline" data-testid="register-login-link">
              Se connecter
            </Link>
          </p>
        </div>
      </div>
    </PublicLayout>
  );
}

export function ManagerRegister() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ first_name: "", last_name: "", phone: "", email: "", password: "", confirm: "", organization_name: "", reason: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const request = useMutation({
    mutationFn: () => {
      const { confirm: _confirm, ...payload } = form;
      return apiPost<{ status: string }>("/manager-requests", payload);
    },
    onSuccess: () => { toast.success("Demande envoyée. Elle sera examinée par l’administrateur."); navigate("/"); },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <PublicLayout>
      <div className="mx-auto w-full max-w-2xl px-4 py-10 md:px-5 md:py-16">
        <div className="rounded-3xl border border-border/70 bg-card p-6 shadow-xl shadow-primary/5 animate-rise md:p-8">
          <Brand compact />
          <h1 className="mt-6 font-heading text-3xl">Demande pour devenir gérant</h1>
          <p className="mt-1 text-sm text-muted-foreground">Votre accès gérant sera activé uniquement après validation par l’administrateur principal.</p>
          <form className="mt-7 grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (form.password !== form.confirm) { toast.error("Les mots de passe ne correspondent pas"); return; } request.mutate(); }}>
            {([['first_name', 'Prénom'], ['last_name', 'Nom'], ['phone', 'Téléphone'], ['email', 'Email'], ['organization_name', 'Nom de votre gérance']] as const).map(([key, text]) => (
              <div key={key} className="space-y-2"><Label htmlFor={`manager-${key}`}>{text}</Label><Input id={`manager-${key}`} required value={form[key]} onChange={set(key)} /></div>
            ))}
            <div className="space-y-2"><Label htmlFor="manager-password">Mot de passe</Label><Input id="manager-password" type="password" minLength={6} required value={form.password} onChange={set("password")} /></div>
            <div className="space-y-2"><Label htmlFor="manager-confirm">Confirmation</Label><Input id="manager-confirm" type="password" required value={form.confirm} onChange={set("confirm")} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="manager-reason">Présentation ou motif</Label><Input id="manager-reason" value={form.reason} onChange={set("reason")} /></div>
            <Button type="submit" className="sm:col-span-2" disabled={request.isPending}>{request.isPending ? "Envoi…" : "Envoyer ma demande"}</Button>
          </form>
          <p className="mt-5 text-sm text-muted-foreground">Déjà gérant ? <Link to="/connexion" className="text-primary hover:underline">Se connecter</Link></p>
        </div>
      </div>
    </PublicLayout>
  );
}

export function Forgot() {
  const [email, setEmail] = useState("");
  return (
    <PublicLayout>
      <div className="mx-auto w-full max-w-md px-5 py-16">
        <div className="rounded-3xl border border-border/70 bg-card p-8 shadow-xl shadow-primary/5">
          <h1 className="font-heading text-3xl">Mot de passe oublié</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            La réinitialisation par email n'est pas encore activée dans cette version. Contactez le responsable de votre
            gérance : il pourra vous réattribuer un accès.
          </p>
          <div className="mt-6 space-y-2">
            <Label htmlFor="femail">Votre email</Label>
            <Input id="femail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="forgot-email-input" />
          </div>
          <Button
            className="mt-4 w-full"
            data-testid="forgot-submit-button"
            onClick={() =>
              toast.info(
                email
                  ? "Aucun email n'est envoyé pour l'instant : contactez le responsable de votre gérance pour rétablir votre accès."
                  : "Saisissez votre email, puis contactez le responsable de votre gérance pour rétablir votre accès.",
              )
            }
          >
            Comment récupérer mon accès ?
          </Button>
        </div>
      </div>
    </PublicLayout>
  );
}
