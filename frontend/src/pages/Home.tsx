import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Receipt, Users, CalendarClock, Wallet, ArrowRight } from "lucide-react";
import { PublicLayout } from "@/components/Shell";
import { buttonVariants } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import { fcfa, type Tontine } from "@/lib/types";

const PILLARS = [
  { icon: ShieldCheck, title: "Chaque gérance est étanche", text: "Une tontine appartient à une seule gérance. Aucune donnée ne traverse d'une gérance à l'autre." },
  { icon: Receipt, title: "Preuve avant validation", text: "Un paiement Wave n'est jamais confirmé automatiquement : un responsable vérifie la capture réelle." },
  { icon: CalendarClock, title: "Un calendrier unique", text: "Toutes les échéances viennent d'une source centrale : membre, gérant et administrateur voient la même chose." },
  { icon: Users, title: "Branches et prises maîtrisées", text: "Un même membre peut gérer plusieurs branches et prises, chacune suivie séparément." },
];

export default function Home() {
  const { data: tontines, isError } = useQuery({
    queryKey: ["tontines", "public"],
    queryFn: () => apiGet<Tontine[]>("/tontines/public"),
    retry: false,
  });
  const preview = (isError ? [] : tontines ?? []).slice(0, 3);

  return (
    <PublicLayout>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -left-24 -top-32 size-[26rem] rounded-full bg-primary/15 blur-3xl animate-glow" />
        <div className="pointer-events-none absolute right-[-8rem] top-24 size-[22rem] rounded-full bg-accent/60 blur-3xl" />
        <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 md:px-5 md:py-20 lg:grid-cols-[1.15fr_0.85fr] lg:py-28">
          <div className="animate-rise">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-xs uppercase tracking-[0.2em] text-primary">
              Tontine encadrée • Côte d'Ivoire
            </span>
            <h1 className="mt-6 font-heading text-[2.6rem] leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Cotiser ensemble,
              <span className="block text-primary">recevoir sereinement.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base text-muted-foreground md:mt-6 md:text-lg">
              AIDONS-NOUS VIVANTS encadre vos tontines quotidiennes : cotisations suivies au jour près, preuves de
              paiement vérifiées par un responsable, positions et prises confirmées une par une.
            </p>
            <div className="mt-8 flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center sm:gap-3">
              <Link to="/creer-mon-compte" className={buttonVariants({ size: "lg", className: "w-full sm:w-auto" })} data-testid="hero-register-button">
                Créer mon compte
              </Link>
              <Link to="/connexion" className={buttonVariants({ size: "lg", variant: "ghost", className: "w-full sm:w-auto" })} data-testid="hero-login-link">
                Déjà un compte ? Se connecter
              </Link>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">La création du compte est gratuite.</p>
            <div className="mt-8 grid gap-4 border-t border-border/70 pt-6 sm:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-background/60 p-4">
                <p className="font-heading text-lg">Espace membre</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link to="/connexion" className={buttonVariants({ size: "sm" })}>Se connecter</Link>
                  <Link to="/creer-mon-compte" className={buttonVariants({ size: "sm", variant: "outline" })}>Créer un compte</Link>
                </div>
              </div>
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
                <p className="font-heading text-lg">Vous êtes gérant ?</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link to="/connexion" className={buttonVariants({ size: "sm" })}>Se connecter</Link>
                  <Link to="/devenir-gerant" className={buttonVariants({ size: "sm", variant: "outline" })}>Créer un compte gérant</Link>
                </div>
              </div>
            </div>
          </div>

          <div className="relative animate-rise rounded-3xl border border-border/70 bg-card/80 p-6 shadow-xl shadow-primary/5 backdrop-blur lg:mt-6">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Exemple de formule</p>
            <p className="mt-3 font-heading text-4xl">550 FCFA <span className="text-base font-sans text-muted-foreground">par jour</span></p>
            <ul className="mt-5 space-y-3 text-sm">
              {[
                ["50 000 FCFA", "tous les 5 jours"],
                ["20 membres", "branches et prises suivies"],
                ["20 bénéficiaires", "dates fixées d'avance"],
                ["100 jours", "durée totale"],
              ].map(([a, b]) => (
                <li key={a} className="flex items-baseline justify-between gap-4 border-b border-dashed border-border pb-2 last:border-0">
                  <span className="font-medium">{a}</span>
                  <span className="text-muted-foreground">{b}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex items-center gap-2 rounded-xl bg-secondary/70 px-3 py-2 text-sm">
              <Wallet className="size-4 text-primary" />
              <span>Paiement Wave avec preuve — vérifié manuellement</span>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-12 md:px-5 md:py-16">
        <h2 className="font-heading text-2xl md:text-3xl">Une plateforme, des règles claires</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {PILLARS.map((p, i) => (
            <div
              key={p.title}
              className={`rounded-2xl border border-border/70 bg-card p-6 transition-transform duration-300 hover:-translate-y-1 ${i % 2 ? "md:mt-8" : ""}`}
            >
              <p.icon className="size-6 text-primary" />
              <h3 className="mt-4 font-heading text-xl">{p.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-5 md:pb-20">
        <div className="flex items-end justify-between gap-4">
          <h2 className="font-heading text-2xl md:text-3xl">Tontines ouvertes</h2>
          <Link to="/tontines-disponibles" className="inline-flex items-center gap-1 text-sm text-primary hover:underline" data-testid="home-all-tontines-link">
            Tout voir <ArrowRight className="size-4" />
          </Link>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-3" data-testid="home-tontine-preview">
          {preview.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground md:col-span-3">
              Aucune tontine ouverte pour le moment. Les nouvelles formules apparaîtront ici.
            </p>
          ) : (
            preview.map((t) => (
              <Link
                key={t.id}
                to={`/details-tontine?id=${t.id}`}
                className="rounded-2xl border border-border/70 bg-card p-5 transition-shadow duration-300 hover:shadow-lg hover:shadow-primary/10"
              >
                <p className="font-heading text-xl">{t.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t.gerance_name}</p>
                <p className="mt-4 text-primary">{fcfa(t.daily_amount)} / jour</p>
                <p className="text-sm text-muted-foreground">Prise de {fcfa(t.payout_amount)}</p>
              </Link>
            ))
          )}
        </div>
      </section>
    </PublicLayout>
  );
}
