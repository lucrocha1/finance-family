import { useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileDown,
  Handshake,
  LayoutDashboard,
  Menu,
  Moon,
  Settings,
  Sun,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { useFamily } from "@/contexts/FamilyContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useEnsureNotificationsGenerated } from "@/hooks/useEnsureNotificationsGenerated";
import { useEnsureRecurrencesGenerated } from "@/hooks/useEnsureRecurrencesGenerated";
import { useNotifications, type NotificationSeverity } from "@/hooks/useNotifications";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import sidebarLogo from "@/assets/sidebar-logo.png";

const MAIN_ITEMS = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Transações", path: "/transactions", icon: ArrowLeftRight },
  { label: "Cartões", path: "/cards", icon: CreditCard },
  { label: "Investimentos", path: "/investments", icon: TrendingUp },
  { label: "Dívidas & Empréstimos", path: "/debts", icon: Handshake },
  { label: "Agenda", path: "/schedule", icon: CalendarDays },
] as const;

const EXTRA_ITEMS = [
  { label: "Relatórios", path: "/reports", icon: BarChart3 },
  { label: "Metas & Orçamento", path: "/goals", icon: Target },
  { label: "Importar CSV", path: "/import", icon: FileDown },
] as const;

const BOTTOM_ITEMS = [
  { label: "Família", path: "/family", icon: Users },
  { label: "Configurações", path: "/settings", icon: Settings },
] as const;

const ALL_ITEMS = [...MAIN_ITEMS, ...EXTRA_ITEMS, ...BOTTOM_ITEMS];

export const AppLayout = () => {
  const { profile, user } = useAuth();
  const { family } = useFamily();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isMobile = useIsMobile();

  useEnsureRecurrencesGenerated(family?.id);
  useEnsureNotificationsGenerated(user?.id);
  const { items: notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications(user?.id);

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isCollapsed = !isMobile && collapsed;

  const desktopSidebarWidth = isCollapsed ? "72px" : "260px";

  const pageTitle = useMemo(() => {
    return ALL_ITEMS.find((item) => item.path === pathname)?.label ?? "Dashboard";
  }, [pathname]);

  const metadataName =
    typeof user?.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : typeof user?.user_metadata?.name === "string"
        ? user.user_metadata.name
        : "";

  const displayName = profile?.full_name?.trim() || metadataName.trim() || "Usuário";

  const initials = displayName
    .toString()
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "U";

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  const renderMenuItem = (item: (typeof ALL_ITEMS)[number]) => {
    const content = (
      <NavLink
        key={item.path}
        to={item.path}
        onClick={() => setMobileOpen(false)}
        className={({ isActive }) =>
          cn(
            "relative mx-3 flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-medium transition-all duration-200",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:left-[-12px] before:top-1/2 before:h-1.5 before:w-1.5 before:-translate-y-1/2 before:rounded-full before:bg-sidebar-primary"
              : "text-sidebar-foreground/85 hover:bg-[hsl(var(--sidebar-hover-bg))] hover:text-sidebar-foreground",
          )
        }
      >
        {({ isActive }) => (
          <>
            <item.icon className={cn("h-5 w-5 shrink-0 transition-colors duration-200", isActive ? "text-sidebar-primary" : "text-sidebar-foreground/85 group-hover:text-sidebar-foreground")} />
            {!isCollapsed && <span className="truncate">{item.label}</span>}
          </>
        )}
      </NavLink>
    );

    if (isCollapsed && !isMobile) {
      return (
        <Tooltip key={item.path}>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent side="right" className="border-border bg-card text-card-foreground">
            {item.label}
          </TooltipContent>
        </Tooltip>
      );
    }

    return content;
  };

  return (
    <div className="min-h-screen">
      {isMobile && mobileOpen && (
        <button
          aria-label="Fechar menu"
          className="fixed inset-0 z-30 bg-[hsl(var(--overlay)/0.5)]"
          onClick={() => setMobileOpen(false)}
          type="button"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300",
          isMobile ? "w-[260px]" : "",
          isMobile ? (mobileOpen ? "translate-x-0" : "-translate-x-full") : "translate-x-0",
        )}
        style={{ width: isMobile ? "260px" : desktopSidebarWidth }}
      >
        <div className="relative flex h-16 items-center border-b border-sidebar-border bg-[hsl(var(--sidebar-header-bg))] px-4">
          <div className={cn("flex items-center", isCollapsed ? "justify-center" : "gap-2.5")}>
            <img src={sidebarLogo} alt="Finance Family" className="h-9 w-9 rounded-md object-cover" />
            {!isCollapsed && <span className="text-lg font-bold text-primary">Finance Family</span>}
          </div>
          {!isMobile && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setCollapsed((prev) => !prev)}
              className="absolute right-3 h-8 w-8 rounded-md text-sidebar-foreground/70 hover:bg-[hsl(var(--sidebar-hover-bg))] hover:text-sidebar-foreground"
              aria-label={isCollapsed ? "Expandir sidebar" : "Recolher sidebar"}
            >
              {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          )}
        </div>

        <nav className="flex min-h-0 flex-1 flex-col pb-3">
          <div className="space-y-1">{MAIN_ITEMS.map(renderMenuItem)}</div>

          <div className="mx-3 my-3 h-px bg-border" />

          <div className="space-y-1">
            {!isCollapsed && <p className="px-4 pb-1 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/55">Extras</p>}
            {EXTRA_ITEMS.map(renderMenuItem)}
          </div>

          <div className="mx-3 my-3 h-px bg-border" />

          <div className="mt-auto space-y-1">{BOTTOM_ITEMS.map(renderMenuItem)}</div>
        </nav>
      </aside>

      <div className="transition-all duration-300" style={{ marginLeft: isMobile ? "0px" : desktopSidebarWidth }}>
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border/40 bg-transparent px-6 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            {isMobile && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:bg-secondary"
                onClick={() => setMobileOpen(true)}
                aria-label="Abrir menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
            )}
            <h1 className="text-xl font-bold text-foreground">{pageTitle}</h1>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={toggleTheme}
              className="relative text-muted-foreground transition-colors hover:text-foreground"
              aria-label={isDark ? "Ativar tema claro" : "Ativar tema escuro"}
            >
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="relative text-muted-foreground transition-colors hover:text-foreground" aria-label="Notificações">
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-96 rounded-xl border-border bg-card p-2 text-card-foreground shadow-2xl">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notificações</span>
                  {unreadCount > 0 && (
                    <button type="button" onClick={() => void markAllAsRead()} className="text-xs font-semibold text-primary hover:underline">
                      Marcar todas
                    </button>
                  )}
                </div>
                {notifications.length === 0 ? (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">Sem notificações por enquanto</div>
                ) : (
                  <div className="max-h-96 space-y-1 overflow-y-auto">
                    {notifications.slice(0, 12).map((item) => {
                      const sev: NotificationSeverity = item.severity;
                      const dotColor =
                        sev === "danger" ? "bg-destructive" :
                        sev === "warning" ? "bg-warning" :
                        sev === "celebrate" ? "bg-success" :
                        "bg-info";
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            void markAsRead(item.id);
                            if (item.link_to) navigate(item.link_to);
                          }}
                          className={cn("flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-secondary", item.read_at && "opacity-60")}
                        >
                          <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dotColor)} />
                          <div className="min-w-0 flex-1">
                            <p className={cn("truncate text-sm", item.read_at ? "font-normal" : "font-semibold", "text-foreground")}>{item.title}</p>
                            {item.body && <p className="line-clamp-2 text-xs text-muted-foreground">{item.body}</p>}
                            <p className="mt-1 text-[10px] text-muted-foreground">{new Date(item.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="h-6 w-px bg-border" />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex items-center gap-3 rounded-lg px-1 py-1 text-left transition-colors hover:bg-secondary">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{initials}</span>
                  <span className="hidden text-sm font-semibold text-foreground sm:block">{displayName}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-xl border-border bg-card text-card-foreground shadow-2xl">
                <DropdownMenuItem onClick={() => navigate("/settings")}>Perfil</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/settings")}>Configurações</DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border" />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="h-[calc(100vh-4rem)] overflow-y-auto px-6 py-6">
          <div className="mx-auto w-full max-w-[1400px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};
