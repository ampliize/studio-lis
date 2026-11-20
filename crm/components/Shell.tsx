"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { CalendarDays, Columns3, LayoutDashboard, LifeBuoy, LogOut, Menu, MessagesSquare, Settings, Sparkles, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Avatar } from "./ui";

type Counts = { transbordos: number; naoLidas: number };

const GROUPS = [
  { label: "Visão geral", items: [{ href: "/", label: "Painel", icon: LayoutDashboard }] },
  {
    label: "Atendimento",
    items: [
      { href: "/conversas", label: "Conversas", icon: MessagesSquare, count: "naoLidas" as const },
      { href: "/transbordos", label: "Com a Lis", icon: LifeBuoy, count: "transbordos" as const, alert: true },
      { href: "/agenda", label: "Agenda", icon: CalendarDays },
      { href: "/pipeline", label: "Funil", icon: Columns3 },
      { href: "/leads", label: "Clientes", icon: Users },
    ],
  },
  {
    label: "Studio",
    items: [
      { href: "/servicos", label: "Serviços e horários", icon: Sparkles },
      { href: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

export default function Shell({ children, flush }: { children: React.ReactNode; flush?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [counts, setCounts] = useState<Counts>({ transbordos: 0, naoLidas: 0 });
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [path]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session === null) router.replace("/login"); }, [session, router]);

  useEffect(() => {
    if (!session) return;
    const load = async () => {
      const [h, n] = await Promise.all([
        supabase.from("handoffs").select("id", { count: "exact", head: true }).eq("status", "aberto"),
        supabase.rpc("crm_inbox", { p_filtro: "nao_lidas", p_busca: null }),
      ]);
      setCounts({ transbordos: h.count ?? 0, naoLidas: (n.data as unknown[] | null)?.length ?? 0 });
    };
    load();
    const ch = supabase.channel("shell-counts")
      .on("postgres_changes", { event: "*", schema: "public", table: "handoffs" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session]);

  if (!session) return <div className="login muted">Carregando…</div>;
  const email = session.user.email ?? "";

  return (
    <div className={`app ${open ? "menu-open" : ""}`}>
      <header className="topbar">
        <button className="btn ghost sm" aria-label="Abrir menu" onClick={() => setOpen(true)}><Menu size={20} /></button>
        <span className="brand-mark sm">LC</span>
        <b>Studio Lis Cazais</b>
        {counts.transbordos + counts.naoLidas > 0 && <span className="count">{counts.transbordos + counts.naoLidas}</span>}
      </header>
      <div className="scrim" onClick={() => setOpen(false)} />
      <aside className="sidebar">
        <button className="btn ghost sm close-menu" aria-label="Fechar menu" onClick={() => setOpen(false)}><X size={20} /></button>
        <div className="brand">
          <span className="brand-mark">LC</span>
          <div><b>Studio Lis Cazais</b><small>Atendimento da Laura</small></div>
        </div>
        {GROUPS.map((g) => (
          <nav className="nav" key={g.label}>
            <div className="nav-label">{g.label}</div>
            {g.items.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              const Icon = n.icon;
              const c = "count" in n && n.count ? counts[n.count] : 0;
              return (
                <Link key={n.href} href={n.href} className={active ? "active" : ""}>
                  <Icon size={18} />{n.label}
                  {c > 0 && <span className={`count ${"alert" in n && n.alert ? "" : "soft"}`}>{c}</span>}
                </Link>
              );
            })}
          </nav>
        ))}
        <div className="spacer" />
        <div className="me">
          <Avatar name={email} size="sm" />
          <span className="who" title={email}>{email}</span>
          <button className="btn ghost sm" title="Sair" onClick={() => supabase.auth.signOut()}><LogOut size={16} /></button>
        </div>
      </aside>
      <main className={`main ${flush ? "flush" : ""}`}>{children}</main>
    </div>
  );
}
