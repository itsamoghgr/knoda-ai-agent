"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BarChart2,
  Brain,
  Clock,
  Database,
  Menu,
  MessageSquare,
  Moon,
  Plug,
  Sun,
  Users,
  X,
  Zap,
  ArrowRight,
  Check,
  Twitter,
  Linkedin,
} from "lucide-react";
import { motion, useInView, useReducedMotion, AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);
  return scrolled;
}

function useCountUp(target: number, duration = 1500, start = false) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return;
    const startTime = performance.now();
    const frame = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      setValue(Math.floor(progress * target));
      if (progress < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, [start, target, duration]);
  return value;
}

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

// ─── Dot grid background ──────────────────────────────────────────────────────

function DotGrid() {
  return (
    <svg
      className="absolute inset-0 h-full w-full opacity-[0.25] dark:opacity-[0.18] pointer-events-none"
      aria-hidden="true"
    >
      <defs>
        <pattern id="dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dots)" />
    </svg>
  );
}

// ─── Logo mark ────────────────────────────────────────────────────────────────

function KMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect width="28" height="28" rx="7" className="fill-primary" />
      <path
        d="M8 7v14M8 14l7-7M8 14l7 7"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Navbar ───────────────────────────────────────────────────────────────────

function Navbar() {
  const scrolled = useScrolled();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const shouldReduce = useReducedMotion();

  useEffect(() => setMounted(true), []);

  const links = [
    { label: "How it works", id: "how-it-works" },
    { label: "Features", id: "features" },
    { label: "Contact", id: "contact" },
  ];

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled ? "border-b bg-background/90 backdrop-blur-md" : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <KMark size={28} />
          <span className="text-lg font-bold tracking-tight" style={{ fontFamily: "var(--font-syne)" }}>
            Luray.ai
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          {links.map((l) => (
            <button
              key={l.id}
              onClick={() => scrollTo(l.id)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {l.label}
            </button>
          ))}
        </nav>

        {/* Right controls */}
        <div className="flex items-center gap-2">
          {/* Theme toggle — render after mount to avoid hydration mismatch */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            {!mounted ? (
              <span className="h-4 w-4" />
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                {theme === "dark" ? (
                  <motion.span
                    key="sun"
                    initial={shouldReduce ? {} : { rotate: -90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={shouldReduce ? {} : { rotate: 90, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Sun className="h-4 w-4" />
                  </motion.span>
                ) : (
                  <motion.span
                    key="moon"
                    initial={shouldReduce ? {} : { rotate: 90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={shouldReduce ? {} : { rotate: -90, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Moon className="h-4 w-4" />
                  </motion.span>
                )}
              </AnimatePresence>
            )}
          </Button>

          {/* Log in — desktop */}
          <Link href="/auth/login" className="hidden md:inline-flex">
            <Button variant="outline" size="sm">Log in</Button>
          </Link>

          {/* Mobile hamburger */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <div className="flex flex-col gap-6 pt-8">
                {links.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => { scrollTo(l.id); setOpen(false); }}
                    className="text-left text-base font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {l.label}
                  </button>
                ))}
                <Separator />
                <Link href="/auth/login" onClick={() => setOpen(false)}>
                  <Button className="w-full">Log in</Button>
                </Link>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

const MONTHS = ["Jul", "Aug", "Sep", "Oct", "Nov"];
const BARS = [52, 68, 61, 79, 100];

function HeroChatCard() {
  const shouldReduce = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (shouldReduce) { setStep(3); return; }
    const t1 = setTimeout(() => setStep(1), 500);
    const t2 = setTimeout(() => setStep(2), 1400);
    const t3 = setTimeout(() => setStep(3), 2800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [shouldReduce]);

  const fade = (delay = 0) => ({
    initial: shouldReduce ? {} : { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.4, delay },
  });

  return (
    <Card className="w-full max-w-sm shadow-2xl border bg-card font-mono text-xs relative overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
        </div>
        <span className="text-muted-foreground text-[10px] ml-1">luray · analyst</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-emerald-500">live</span>
        </span>
      </div>

      <CardContent className="p-4 space-y-4 min-h-[260px]">
        {/* User message */}
        <AnimatePresence>
          {step >= 1 && (
            <motion.div {...fade()} className="flex justify-end">
              <div className="rounded-xl rounded-tr-sm bg-primary px-3 py-2 text-primary-foreground max-w-[80%]">
                What was our revenue last month?
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Thinking */}
        <AnimatePresence>
          {step === 2 && (
            <motion.div {...fade()} className="space-y-1.5 text-muted-foreground">
              <ThinkingDots />
              <p className="text-[10px]">→ Searching AI Memory...</p>
              <p className="text-[10px]">→ Writing SQL query...</p>
              <p className="text-[10px]">→ Running against live database...</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Response */}
        <AnimatePresence>
          {step >= 3 && (
            <motion.div {...fade()} className="space-y-3">
              <div className="space-y-1.5 text-muted-foreground text-[10px]">
                <p>→ Searching AI Memory...</p>
                <p>→ Writing SQL query...</p>
                <p>→ Running against live database...</p>
              </div>
              <div className="rounded-xl rounded-tl-sm border bg-muted/40 px-4 py-3 space-y-2">
                <p className="text-3xl font-bold tracking-tight text-foreground">$2.4M</p>
                <p className="text-[10px] text-muted-foreground">Total Revenue · November 2024</p>
                {/* Mini bar chart */}
                <div className="flex items-end gap-1 h-10 pt-2">
                  {BARS.map((h, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className={`w-full rounded-sm transition-all ${i === BARS.length - 1 ? "bg-primary" : "bg-muted-foreground/30"}`}
                        style={{ height: `${(h / 100) * 32}px` }}
                      />
                      <span className="text-[8px] text-muted-foreground">{MONTHS[i]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 h-4">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

function Hero() {
  const shouldReduce = useReducedMotion();
  return (
    <section className="relative min-h-screen flex items-center overflow-hidden pt-16">
      <DotGrid />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background pointer-events-none" />

      <div className="relative mx-auto max-w-6xl px-6 py-24 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Text */}
          <div className="space-y-8">
            <motion.div
              initial={shouldReduce ? {} : { opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <Badge variant="outline" className="font-mono text-xs mb-6 gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Now in private beta
              </Badge>
              <h1
                className="text-5xl md:text-6xl font-extrabold leading-[1.08] tracking-tight"
                style={{ fontFamily: "var(--font-syne)" }}
              >
                The AI that knows your data.
              </h1>
            </motion.div>

            <motion.p
              initial={shouldReduce ? {} : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15 }}
              className="text-lg text-muted-foreground leading-relaxed max-w-lg"
            >
              Luray connects to your database, maps everything it finds, and becomes the data analyst your team never had to hire. Ask questions. Get answers. In meetings, in Slack, in seconds.
            </motion.p>

            <motion.div
              initial={shouldReduce ? {} : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="flex flex-wrap gap-3"
            >
              <Button size="lg" onClick={() => scrollTo("contact")} className="gap-2">
                Get in touch <ArrowRight className="h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => scrollTo("how-it-works")}>
                See how it works
              </Button>
            </motion.div>

            <motion.div
              initial={shouldReduce ? {} : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="flex flex-wrap gap-4 text-xs text-muted-foreground font-mono"
            >
              {["PostgreSQL", "MySQL", "DuckDB", "S3 / Parquet"].map((db) => (
                <span key={db} className="flex items-center gap-1.5">
                  <Check className="h-3 w-3 text-emerald-500" /> {db}
                </span>
              ))}
            </motion.div>
          </div>

          {/* Chat card */}
          <motion.div
            initial={shouldReduce ? {} : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="flex justify-center lg:justify-end"
          >
            <HeroChatCard />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ─── Social proof ─────────────────────────────────────────────────────────────

const COMPANIES = ["Meridian", "Arcova", "Lendex", "Quantra", "Veritas", "Solera"];

function SocialProof() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const shouldReduce = useReducedMotion();

  return (
    <section ref={ref} className="border-y bg-muted/30 py-10">
      <div className="mx-auto max-w-6xl px-6">
        <motion.div
          initial={shouldReduce ? {} : { opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.8 }}
          className="flex flex-col items-center gap-6"
        >
          <p className="text-xs text-muted-foreground tracking-widest uppercase">
            Built for data teams at companies like
          </p>
          <div className="flex flex-wrap justify-center gap-8 md:gap-12">
            {COMPANIES.map((name, i) => (
              <motion.span
                key={name}
                initial={shouldReduce ? {} : { opacity: 0 }}
                animate={inView ? { opacity: 1 } : {}}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="text-sm font-semibold text-muted-foreground/50 tracking-wide"
                style={{ fontFamily: "var(--font-syne)" }}
              >
                {name}
              </motion.span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ─── Problem ──────────────────────────────────────────────────────────────────

const PROBLEMS = [
  {
    icon: Database,
    title: "Data only engineers can access",
    body: "Every insight requires a ticket, a query, and days of waiting.",
  },
  {
    icon: Clock,
    title: "Dashboards that are already outdated",
    body: "By the time the report lands, the moment to act has passed.",
  },
  {
    icon: Users,
    title: "Analysts stuck doing repetitive work",
    body: "90% of their time goes to the same queries, the same slides, the same meetings.",
  },
];

function ProblemSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const shouldReduce = useReducedMotion();

  return (
    <section id="how-it-works" ref={ref} className="py-28">
      <div className="mx-auto max-w-6xl px-6 space-y-16">
        <motion.div
          initial={shouldReduce ? {} : { opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="max-w-2xl space-y-4"
        >
          <h2
            className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight"
            style={{ fontFamily: "var(--font-syne)" }}
          >
            Your data is locked. Your team is waiting.
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            The bottleneck is always the same. Business teams have questions. Engineers own the databases. Analysts sit in the middle — translating, building, presenting. Slow. Expensive. Doesn&apos;t scale.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {PROBLEMS.map(({ icon: Icon, title, body }, i) => (
            <motion.div
              key={title}
              initial={shouldReduce ? {} : { opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: i * 0.12 }}
            >
              <Card className="h-full border bg-card hover:border-primary/30 transition-colors">
                <CardContent className="p-6 space-y-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-semibold text-base">{title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── How it works ─────────────────────────────────────────────────────────────

const STEPS = [
  {
    n: "01",
    icon: Plug,
    title: "Connect your database",
    body: "PostgreSQL, MySQL, DuckDB, or S3. Read-only. Secure. No code required.",
  },
  {
    n: "02",
    icon: Brain,
    title: "Luray maps everything",
    body: "The agent explores your schema, classifies every table, infers relationships, and builds AI Memory — a persistent understanding of your data.",
  },
  {
    n: "03",
    icon: MessageSquare,
    title: "Ask anything. Get answers.",
    body: "Plain English questions. SQL written and run automatically. Charts, dashboards, and meeting presentations — delivered.",
  },
];

function HowItWorks() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const shouldReduce = useReducedMotion();

  return (
    <section ref={ref} className="py-28 bg-muted/20">
      <div className="mx-auto max-w-6xl px-6 space-y-16">
        <motion.h2
          initial={shouldReduce ? {} : { opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-4xl md:text-5xl font-extrabold tracking-tight"
          style={{ fontFamily: "var(--font-syne)" }}
        >
          Up and running in minutes.
        </motion.h2>

        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-10">
          {/* Dashed connector — desktop only */}
          <div className="hidden md:block absolute top-8 left-[calc(33%+16px)] right-[calc(33%+16px)] border-t border-dashed border-border" />

          {STEPS.map(({ n, icon: Icon, title, body }, i) => (
            <motion.div
              key={n}
              initial={shouldReduce ? {} : { opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: i * 0.15 }}
              className="flex flex-col gap-4"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border bg-card">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <span className="font-mono text-3xl font-bold text-muted-foreground/30">{n}</span>
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold" style={{ fontFamily: "var(--font-syne)" }}>{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Feature A: AI Memory ─────────────────────────────────────────────────────

const TABLE_ROWS = [
  { name: "users",           type: "Entity",  label: "User",       color: "teal" },
  { name: "orders",          type: "Entity",  label: "Order",      color: "teal" },
  { name: "revenue_events",  type: "Metric",  label: "Revenue",    color: "amber" },
  { name: "products",        type: "Entity",  label: "Product",    color: "teal" },
  { name: "sessions",        type: "Metric",  label: "Engagement", color: "amber" },
];

function TableDiscoveryCard() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const shouldReduce = useReducedMotion();

  return (
    <div
      ref={ref}
      className="w-full max-w-sm rounded-xl border bg-card shadow-xl overflow-hidden font-mono text-xs"
    >
      <div className="border-b px-4 py-3 flex items-center gap-2">
        <Database className="h-3.5 w-3.5 text-primary" />
        <span className="text-muted-foreground text-[10px]">discovery · schema mapping</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] text-primary">scanning</span>
        </span>
      </div>
      <div className="divide-y">
        {TABLE_ROWS.map((row, i) => (
          <motion.div
            key={row.name}
            initial={shouldReduce ? {} : { opacity: 0, x: -8 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.3, delay: i * 0.25 }}
            className="flex items-center justify-between px-4 py-3"
          >
            <span className="text-foreground">{row.name}</span>
            <span className="text-muted-foreground mx-3">→</span>
            <Badge
              variant="outline"
              className={`text-[10px] font-mono shrink-0 ${
                row.color === "teal"
                  ? "border-teal-500/40 text-teal-600 dark:text-teal-400"
                  : "border-amber-500/40 text-amber-600 dark:text-amber-400"
              }`}
            >
              {row.type}: {row.label}
            </Badge>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─── Feature B: Analyst Agent ─────────────────────────────────────────────────

function AnalystFlowCard() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const shouldReduce = useReducedMotion();

  const panel = (delay: number) => ({
    initial: shouldReduce ? {} : { opacity: 0, x: -16 },
    animate: inView ? { opacity: 1, x: 0 } : {},
    transition: { duration: 0.5, delay },
  });

  return (
    <div ref={ref} className="w-full max-w-lg space-y-3 font-mono text-xs">
      {/* Panel 1 — user message */}
      <motion.div {...panel(0)} className="rounded-xl border bg-card p-4 flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">JM</div>
        <div className="rounded-xl rounded-tl-sm bg-muted px-3 py-2 text-foreground leading-relaxed">
          Show me churn by region this quarter
        </div>
      </motion.div>

      <motion.div
        {...panel(0.15)}
        className="flex items-center justify-center text-muted-foreground/40"
      >
        <ArrowRight className="h-4 w-4" />
      </motion.div>

      {/* Panel 2 — reasoning */}
      <motion.div {...panel(0.3)} className="rounded-xl border bg-card p-4 space-y-1.5">
        <div className="flex items-center gap-2 mb-2">
          <Brain className="h-3.5 w-3.5 text-primary" />
          <span className="text-[10px] text-primary">luray · reasoning</span>
        </div>
        <p className="text-muted-foreground">→ Searching AI Memory for churn tables...</p>
        <p className="text-muted-foreground">→ Found: subscription_events, user_regions</p>
        <p className="text-muted-foreground">→ Writing SQL...</p>
        <p className="text-foreground">→ Running query... <span className="text-emerald-500">✓ 847 rows</span></p>
      </motion.div>

      <motion.div
        {...panel(0.45)}
        className="flex items-center justify-center text-muted-foreground/40"
      >
        <ArrowRight className="h-4 w-4" />
      </motion.div>

      {/* Panel 3 — result */}
      <motion.div {...panel(0.6)} className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-end gap-1 h-12">
          {[
            { label: "APAC", h: 42, v: "4.2%" },
            { label: "EMEA", h: 61, v: "6.1%" },
            { label: "US",   h: 38, v: "3.8%" },
            { label: "LATAM",h: 55, v: "5.5%" },
            { label: "ANZ",  h: 29, v: "2.9%" },
          ].map((b) => (
            <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full rounded-sm bg-primary/70"
                style={{ height: `${(b.h / 100) * 40}px` }}
              />
              <span className="text-[8px] text-muted-foreground">{b.label}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
          <span>APAC: <strong className="text-foreground">4.2%</strong></span>
          <span>EMEA: <strong className="text-foreground">6.1%</strong></span>
          <span>US: <strong className="text-foreground">3.8%</strong></span>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Feature C: Communication Agent ──────────────────────────────────────────

function MeetingCard() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const shouldReduce = useReducedMotion();

  return (
    <motion.div
      ref={ref}
      initial={shouldReduce ? {} : { opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6 }}
      className="w-full max-w-sm rounded-xl border bg-card shadow-xl overflow-hidden font-mono text-xs"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between border-b px-4 py-2.5 bg-muted/30">
        <span className="text-[10px] text-muted-foreground">Luray · Q4 Review · 4 participants</span>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
          <span className="text-[10px] text-red-500">REC</span>
        </div>
      </div>

      {/* Participant grid */}
      <div className="grid grid-cols-2 gap-2 p-3">
        {[
          { initials: "JM", name: "Jordan M." },
          { initials: "SR", name: "Sam R." },
          { initials: "AK", name: "Alex K." },
        ].map((p) => (
          <div key={p.initials} className="rounded-lg border bg-muted/20 p-3 flex flex-col items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-bold text-foreground">
              {p.initials}
            </div>
            <span className="text-[10px] text-muted-foreground">{p.name}</span>
          </div>
        ))}

        {/* Luray tile */}
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 flex flex-col items-center gap-2 relative">
          <div className="relative">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            {/* Pulse ring */}
            <span className="absolute inset-0 rounded-full border-2 border-primary/60 animate-ping" />
          </div>
          <span className="text-[10px] text-primary font-semibold">Luray AI</span>
          {/* Waveform */}
          <div className="flex items-center gap-0.5 h-3">
            {[3, 5, 8, 6, 10, 7, 4, 9, 5, 3].map((h, i) => (
              <span
                key={i}
                className="w-0.5 rounded-full bg-primary/70 animate-[aiwave_1s_ease-in-out_infinite]"
                style={{ height: `${h}px`, animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Shared dashboard */}
      <div className="border-t px-3 py-3 space-y-2">
        <p className="text-[10px] text-muted-foreground">Presenting:</p>
        <div className="grid grid-cols-2 gap-2">
          {["Revenue by Quarter", "Churn by Region"].map((label) => (
            <div key={label} className="rounded-lg border bg-muted/20 p-2 space-y-1.5">
              <div className="flex items-end gap-0.5 h-6">
                {[40, 60, 50, 80, 70].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm bg-primary/50"
                    style={{ height: `${(h / 100) * 20}px` }}
                  />
                ))}
              </div>
              <p className="text-[8px] text-muted-foreground truncate">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Features section ─────────────────────────────────────────────────────────

function FeatureBlock({
  label,
  headline,
  body,
  visual,
  reverse = false,
}: {
  label: string;
  headline: string;
  body: string;
  visual: React.ReactNode;
  reverse?: boolean;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const shouldReduce = useReducedMotion();

  return (
    <div ref={ref} className="py-24 border-b last:border-b-0">
      <div className="mx-auto max-w-6xl px-6">
        <div
          className={`grid grid-cols-1 lg:grid-cols-2 gap-16 items-center ${
            reverse ? "lg:flex lg:flex-row-reverse" : ""
          }`}
        >
          <motion.div
            initial={shouldReduce ? {} : { opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6 }}
            className="space-y-6"
          >
            <span className="font-mono text-xs text-muted-foreground">{label}</span>
            <h2
              className="text-3xl md:text-4xl font-extrabold tracking-tight leading-tight"
              style={{ fontFamily: "var(--font-syne)" }}
            >
              {headline}
            </h2>
            <p className="text-muted-foreground leading-relaxed">{body}</p>
          </motion.div>

          <motion.div
            initial={shouldReduce ? {} : { opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.15 }}
            className={`flex ${reverse ? "lg:justify-start" : "lg:justify-end"} justify-center`}
          >
            {visual}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function FeaturesSection() {
  return (
    <section id="features">
      <FeatureBlock
        label="01 · AI Memory"
        headline="Luray knows your data."
        body="The Discovery Agent maps your entire database — schema, relationships, entities, measures. Every table classified. Every column understood. Stored in AI Memory so Luray never has to learn from scratch again. It gets smarter with every interaction."
        visual={<TableDiscoveryCard />}
      />
      <FeatureBlock
        label="02 · Analyst Agent"
        headline={"Ask in plain English.\nGet SQL-powered answers."}
        body="Not a chatbot. An agent. Luray reads from AI Memory, reasons step-by-step, writes the SQL, runs it against your live database, and delivers the answer — as a number, a chart, or a dashboard. Works in your chat interface, in Slack, or spoken aloud in a live meeting."
        visual={<AnalystFlowCard />}
        reverse
      />
      <FeatureBlock
        label="03 · Communication Agent"
        headline={"Your AI analyst,\nin every meeting."}
        body="Luray joins your Zoom, Teams, or Meet call as a participant. It presents your dashboards with voice, walks through each chart with live insights, and answers questions from the audience in real time using live data. Before the call ends, it has already built the follow-up charts you asked for."
        visual={<MeetingCard />}
      />
    </section>
  );
}

// ─── Metrics bar ──────────────────────────────────────────────────────────────

const METRICS = [
  { value: 5,   suffix: "min",  prefix: "< ", label: "Time to connect your first database" },
  { value: 0,   suffix: "",     prefix: "",   label: "Lines of SQL your team needs to write" },
  { value: 3,   suffix: "",     prefix: "",   label: "Agents working autonomously for you" },
  { value: 999, suffix: "+",    prefix: "",   label: "Questions your team can now answer", display: "∞" },
];

function MetricItem({ m, inView, index }: { m: typeof METRICS[number]; inView: boolean; index: number }) {
  const shouldReduce = useReducedMotion();
  const count = useCountUp(m.value, 1200, inView && !shouldReduce);
  return (
    <motion.div
      initial={shouldReduce ? {} : { opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="flex flex-col items-center text-center gap-2"
    >
      <span
        className="text-5xl font-extrabold text-primary"
        style={{ fontFamily: "var(--font-syne)" }}
      >
        {m.display ?? `${m.prefix}${shouldReduce ? m.value : count}${m.suffix}`}
      </span>
      <span className="text-xs text-muted-foreground leading-snug max-w-[140px]">{m.label}</span>
    </motion.div>
  );
}

function MetricsBar() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section ref={ref} className="py-20 bg-muted/30 border-y">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-4">
          {METRICS.map((m, i) => (
            <MetricItem key={m.label} m={m} inView={inView} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Contact ──────────────────────────────────────────────────────────────────

function ContactSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const shouldReduce = useReducedMotion();

  return (
    <section id="contact" ref={ref} className="py-32">
      <div className="mx-auto max-w-2xl px-6 text-center space-y-8">
        <motion.div
          initial={shouldReduce ? {} : { opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="space-y-4"
        >
          <h2
            className="text-4xl md:text-5xl font-extrabold tracking-tight"
            style={{ fontFamily: "var(--font-syne)" }}
          >
            Curious? Let&apos;s talk.
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Whether you&apos;re a potential user, design partner, or investor — reach out and let&apos;s explore what Luray can do for your team.
          </p>
        </motion.div>

        <motion.a
          initial={shouldReduce ? {} : { opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          href="mailto:contact@itsamoghgr.com"
          className="inline-block text-2xl md:text-3xl font-bold text-primary underline-offset-4 hover:underline transition-all"
          style={{ fontFamily: "var(--font-syne)" }}
        >
          contact@itsamoghgr.com
        </motion.a>

        <motion.p
          initial={shouldReduce ? {} : { opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.35 }}
          className="text-xs text-muted-foreground"
        >
          We&apos;re onboarding early design partners. Expect a response within 24 hours.
        </motion.p>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t py-10">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex flex-col items-center md:items-start gap-1">
            <div className="flex items-center gap-2">
              <KMark size={20} />
              <span className="font-bold text-sm" style={{ fontFamily: "var(--font-syne)" }}>Luray.ai</span>
            </div>
            <p className="text-xs text-muted-foreground">The AI that knows your data.</p>
          </div>

          <div className="flex items-center gap-6 text-xs text-muted-foreground">
            <a href="#" className="hover:text-foreground transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-foreground transition-colors">Terms</a>
          </div>

          <div className="flex items-center gap-3">
            <a href="#" aria-label="Twitter" className="text-muted-foreground hover:text-foreground transition-colors">
              <Twitter className="h-4 w-4" />
            </a>
            <a href="#" aria-label="LinkedIn" className="text-muted-foreground hover:text-foreground transition-colors">
              <Linkedin className="h-4 w-4" />
            </a>
          </div>
        </div>
        <Separator className="my-6" />
        <p className="text-center text-xs text-muted-foreground">© 2025 Luray.ai. All rights reserved.</p>
      </div>
    </footer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <Hero />
      <SocialProof />
      <ProblemSection />
      <HowItWorks />
      <FeaturesSection />
      <MetricsBar />
      <Separator />
      <ContactSection />
      <Footer />
    </div>
  );
}
