import { useState, type ComponentType, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
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

export function PublicLayout({ children, hasBottomBar = false }: { children: ReactNode; hasBottomBar?: boolean }) {
  const { data: me } = useMe();
  const { endSession } = useSession();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const space = me?.role === "admin" ? "/administration" : me?.role === "manager" ? "/gerance" : "/espace-membre";

  const logout = async () => {
    await endSession();
    setMenuOpen(false);
    navigate("/");
  };

  return (
    <div className={`min-h-screen flex flex-col ${hasBottomBar ? "pb-[4.5rem] md:pb-0" : ""}`}>
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 md:gap-6 md:px-5 md:py-3.5">
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

          {/* Desktop actions */}
          <div className="ml-auto hidden items-center gap-2 md:flex">
            {me ? (
              <>
                <Link to={space} className={buttonVariants({ size: "sm" })} data-testid="header-space-link">
                  Mon espace
                </Link>
                <Button size="sm" variant="ghost" data-testid="header-logout-button" onClick={logout}>
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

          {/* Mobile: primary CTA + burger menu */}
          <div className="ml-auto flex items-center gap-1.5 md:hidden">
            {!me && (
              <Link to="/creer-mon-compte" className={buttonVariants({ size: "sm" })} data-testid="header-register-link-mobile">
                Créer
              </Link>
            )}
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger
                className={buttonVariants({ size: "icon-sm", variant: "ghost" })}
                aria-label="Ouvrir le menu"
                data-testid="mobile-menu-button"
              >
                <Menu className="size-5" />
              </SheetTrigger>
              <SheetContent side="right" showCloseButton={false} className="w-[86vw] max-w-sm p-0">
                <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
                  <SheetTitle className="font-heading text-lg">Menu</SheetTitle>
                  <Button size="icon-sm" variant="ghost" onClick={() => setMenuOpen(false)} aria-label="Fermer" data-testid="mobile-menu-close">
                    <X className="size-5" />
                  </Button>
                </div>
                <nav className="flex flex-col p-3 text-base">
                  {me && (
                    <Link
                      to={space}
                      onClick={() => setMenuOpen(false)}
                      className="rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground"
                      data-testid="mobile-menu-space-link"
                    >
                      Mon espace
                    </Link>
                  )}
                  {NAV.map((n) => (
                    <Link
                      key={n.to}
                      to={n.to}
                      onClick={() => setMenuOpen(false)}
                      className="rounded-xl px-4 py-3 transition-colors duration-200 active:bg-accent"
                      data-testid={`mobile-nav-${n.to.slice(1)}`}
                    >
                      {n.text}
                    </Link>
                  ))}
                  <div className="my-2 h-px bg-border" />
                  {me ? (
                    <button
                      onClick={logout}
                      className="rounded-xl px-4 py-3 text-left text-muted-foreground active:bg-accent"
                      data-testid="mobile-menu-logout-button"
                    >
                      Déconnexion
                    </button>
                  ) : (
                    <Link
                      to="/connexion"
                      onClick={() => setMenuOpen(false)}
                      className="rounded-xl px-4 py-3 active:bg-accent"
                      data-testid="mobile-menu-login-link"
                    >
                      Se connecter
                    </Link>
                  )}
                  <Link to="/conditions-utilisation" onClick={() => setMenuOpen(false)} className="rounded-xl px-4 py-3 text-sm text-muted-foreground">
                    Conditions d'utilisation
                  </Link>
                  <Link to="/politique-confidentialite" onClick={() => setMenuOpen(false)} className="rounded-xl px-4 py-3 text-sm text-muted-foreground">
                    Politique de confidentialité
                  </Link>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className={`border-t border-border/70 bg-secondary/40 ${hasBottomBar ? "hidden md:block" : ""}`}>
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

/** Horizontally scrollable tab strip on phones, wrapped rows on desktop.
 *  `w-full`/`max-w-full` are required: TabsList is inline-flex, so without them it
 *  sizes to its content and pushes the whole document wider than the viewport. */
export const scrollTabs =
  "w-full max-w-full flex-nowrap overflow-x-auto no-scrollbar [&>*]:shrink-0 md:flex-wrap";

export interface BottomItem {
  value: string;
  text: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number;
}

/** Thumb-reachable bottom navigation — phones only. */
export function BottomBar({
  items,
  value,
  onChange,
  menuItems = [],
}: {
  items: BottomItem[];
  value: string;
  onChange: (v: string) => void;
  menuItems?: BottomItem[];
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      data-testid="bottom-nav"
    >
      <div className="flex items-stretch">
        {items.map((it) => {
          const active = value === it.value;
          return (
            <button
              key={it.value}
              onClick={() => {
                onChange(it.value);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              data-testid={`bottom-nav-${it.value}`}
              className={`relative flex flex-1 flex-col items-center gap-1 px-1 py-2.5 text-[0.68rem] transition-colors duration-200 ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <span className={`grid size-8 place-items-center rounded-xl transition-colors duration-200 ${active ? "bg-primary/12" : ""}`}>
                <it.icon className="size-[1.15rem]" />
              </span>
              <span className="leading-none">{it.text}</span>
              {it.badge ? (
                <span className="absolute right-1/2 top-1 translate-x-4 rounded-full bg-primary px-1.5 text-[0.6rem] leading-4 text-primary-foreground">
                  {it.badge}
                </span>
              ) : null}
            </button>
          );
        })}
        {menuItems.length > 0 && (
          <Sheet>
            <SheetTrigger
              className="relative flex flex-1 flex-col items-center gap-1 px-1 py-2.5 text-[0.68rem] text-muted-foreground"
              aria-label="Ouvrir le menu"
              data-testid="bottom-nav-menu"
            >
              <span className="grid size-8 place-items-center rounded-xl"><Menu className="size-[1.15rem]" /></span>
              <span className="leading-none">Menu</span>
              {menuItems.find((it) => it.value === "corbeille")?.badge ? (
                <span className="absolute right-1/2 top-1 translate-x-4 rounded-full bg-primary px-1.5 text-[0.6rem] leading-4 text-primary-foreground">
                  {menuItems.find((it) => it.value === "corbeille")?.badge}
                </span>
              ) : null}
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl px-4 pb-8">
              <SheetTitle className="mb-4 font-heading text-xl">Menu</SheetTitle>
              <div className="grid grid-cols-2 gap-2">
                {menuItems.map((it) => (
                  <button
                    key={it.value}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm ${value === it.value ? "border-primary bg-primary/8 text-primary" : "border-border/70"}`}
                    onClick={() => onChange(it.value)}
                  >
                    <it.icon className="size-4" />
                    <span>{it.text}</span>
                    {it.badge ? <span className="ml-auto rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{it.badge}</span> : null}
                  </button>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        )}
      </div>
    </nav>
  );
}

const TONE: Record<string, string> = {  paid: "bg-emerald-100 text-emerald-800 border-emerald-200",
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
