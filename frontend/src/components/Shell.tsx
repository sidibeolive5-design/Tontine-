import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMe, useSession } from "@/lib/session";
import { label } from "@/lib/types";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 group" data-testid="brand-link">
      <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground font-heading text-lg transition-transform duration-300 group-hover:scale-105">
        A
      </span>
      {!compact && (
        <span className="font-heading text-lg leading-tight tracking-tight">
          AIDONS-NOUS
          <span className="block text-[0.68rem] font-sans uppercase tracking-[0.28em] text-primary">Vivants</span>
        </span>
      )}
    </Link>
  );
}

const NAV = [
  { to: "/tontines-disponibles", text: "Tontines disponibles" },
  { to: "/comment-ca-marche", text: "Comment ça marche" },
  { to: "/regles", text: "Règles" },
  { to: "/a-propos", text: "À propos" },
];

export function PublicLayout({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const { endSession } = useSession();
  const navigate = useNavigate();

  const space = me?.role === "admin" ? "/administration" : me?.role === "manager" ? "/gerance" : "/espace-membre";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-5 py-3.5">
          <Brand />
          <nav className="hidden md:flex items-center gap-1 text-sm">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                data-testid={`nav-${n.to.slice(1)}`}
                className="rounded-lg px-3 py-2 text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-accent-foreground"
              >
                {n.text}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {me ? (
              <>
                <Link to={space} className={buttonVariants({ size: "sm" })} data-testid="header-space-link">
                  Mon espace
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="header-logout-button"
                  onClick={async () => {
                    await endSession();
                    navigate("/");
                  }}
                >
                  Déconnexion
                </Button>
              </>
            ) : (
              <>
                <Link to="/connexion" className={buttonVariants({ size: "sm", variant: "ghost" })} data-testid="header-login-link">
                  Se connecter
                </Link>
                <Link to="/creer-mon-compte" className={buttonVariants({ size: "sm" })} data-testid="header-register-link">
                  Créer mon compte
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border/70 bg-secondary/40">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-10 md:grid-cols-3">
          <div className="space-y-3">
            <Brand />
            <p className="max-w-xs text-sm text-muted-foreground">
              La plateforme de tontine qui rend chaque cotisation traçable, chaque prise vérifiée.
            </p>
          </div>
          <div className="text-sm space-y-2">
            <p className="font-medium">Plateforme</p>
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} className="block text-muted-foreground hover:text-primary transition-colors">
                {n.text}
              </Link>
            ))}
          </div>
          <div className="text-sm space-y-2">
            <p className="font-medium">Légal</p>
            <Link to="/conditions-utilisation" className="block text-muted-foreground hover:text-primary transition-colors">
              Conditions d'utilisation
            </Link>
            <Link to="/politique-confidentialite" className="block text-muted-foreground hover:text-primary transition-colors">
              Politique de confidentialité
            </Link>
            <p className="pt-3 text-xs text-muted-foreground">© {new Date().getFullYear()} AIDONS-NOUS VIVANTS</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

const TONE: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-800 border-emerald-200",
  validated: "bg-emerald-100 text-emerald-800 border-emerald-200",
  signed: "bg-emerald-100 text-emerald-800 border-emerald-200",
  accepted: "bg-emerald-100 text-emerald-800 border-emerald-200",
  received: "bg-emerald-100 text-emerald-800 border-emerald-200",
  verified: "bg-emerald-100 text-emerald-800 border-emerald-200",
  active: "bg-emerald-100 text-emerald-800 border-emerald-200",
  late: "bg-red-100 text-red-800 border-red-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  processing: "bg-amber-100 text-amber-900 border-amber-200",
  pending: "bg-amber-100 text-amber-900 border-amber-200",
  due_today: "bg-primary/12 text-primary border-primary/25",
  to_sign: "bg-primary/12 text-primary border-primary/25",
};

export function StatusPill({ value, testId }: { value: string; testId?: string }) {
  return (
    <Badge variant="outline" className={`border ${TONE[value] ?? "bg-muted text-muted-foreground"}`} data-testid={testId}>
      {label(value)}
    </Badge>
  );
}

export function Stat({ title, value, hint, testId }: { title: string; value: string; hint?: string; testId: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-[0_1px_0_oklch(1_0_0)] transition-shadow duration-300 hover:shadow-lg hover:shadow-primary/5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      <p className="mt-1 font-heading text-2xl" data-testid={testId}>
        {value}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Empty({ text, testId }: { text: string; testId?: string }) {
  return (
    <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground" data-testid={testId}>
      {text}
    </p>
  );
}
