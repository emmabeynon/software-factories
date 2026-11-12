// PROTOTYPE, throwaway. Question: how should in-app Notifications look?
// Four structurally different variants of the app shell, switched with
// `?variant=A|B|C|D` on any page inside layout.app.tsx. In-memory stub data
// only; nothing is persisted and nothing mutates the database.
//   A  Bell in a top bar, dropdown list
//   B  Docked activity rail on the right
//   C  "Inbox" entry in the sidebar that opens a full-page inbox
//   D  No inbox: unread badges on existing nav items, plus toasts on arrival
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Inbox,
  MessageSquare,
  Receipt,
  Star,
  UsersRound,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { UserRole } from "~/db/schema";

type Kind =
  | "refund-raised"
  | "refund-decided"
  | "refund-issued"
  | "refund-failed"
  | "seat-claimed"
  | "comment"
  | "rating"
  | "reply";

type Notification = {
  id: number;
  kind: Kind;
  text: string;
  to: string;
  minutesAgo: number;
  read: boolean;
};

const KIND_ICON: Record<Kind, React.ReactNode> = {
  "refund-raised": <Receipt className="size-4" />,
  "refund-decided": <Receipt className="size-4" />,
  "refund-issued": <Receipt className="size-4" />,
  "refund-failed": <AlertTriangle className="size-4 text-red-500" />,
  "seat-claimed": <UsersRound className="size-4" />,
  comment: <MessageSquare className="size-4" />,
  rating: <Star className="size-4" />,
  reply: <MessageSquare className="size-4" />,
};

// Where an unread Notification of this kind lights up a sidebar item (variant D)
const KIND_NAV: Partial<Record<Kind, string>> = {
  "refund-raised": "/admin/refunds",
  "refund-failed": "/admin/refunds",
  comment: "/instructor/questions",
  "seat-claimed": "/team",
  reply: "/dashboard",
};

function seed(role: UserRole | null, isTeamAdmin: boolean): Notification[] {
  const items: Omit<Notification, "id" | "read">[] = [];
  if (role === UserRole.Admin) {
    items.push(
      { kind: "refund-raised", text: "Ava Chen asked for a refund on TypeScript Fundamentals", to: "/admin/refunds", minutesAgo: 4 },
      { kind: "refund-failed", text: "Refund failed for Sam Ortiz ($79.00): the money could not be sent", to: "/admin/refunds", minutesAgo: 95 },
      { kind: "refund-raised", text: "Priya Nair asked for a refund on a Team Licence", to: "/admin/refunds", minutesAgo: 1500 }
    );
  } else if (role === UserRole.Instructor) {
    items.push(
      { kind: "comment", text: "Jo Park asked a question on Lesson 3: Generics", to: "/instructor/questions", minutesAgo: 12 },
      { kind: "rating", text: "Someone rated TypeScript Fundamentals 5 stars", to: "/instructor", minutesAgo: 240 },
      { kind: "comment", text: "Lee Wong commented on Lesson 1: Setup", to: "/instructor/questions", minutesAgo: 1800 }
    );
  } else {
    items.push(
      { kind: "refund-decided", text: "Your refund request for TypeScript Fundamentals was approved", to: "/settings", minutesAgo: 8 },
      { kind: "refund-issued", text: "Your refund of $79.00 was sent", to: "/settings", minutesAgo: 60 },
      { kind: "reply", text: "Your instructor replied to your question on Lesson 3", to: "/courses", minutesAgo: 300 }
    );
  }
  if (isTeamAdmin) {
    items.push({ kind: "seat-claimed", text: "Mia Torres claimed a Seat on your Team Licence", to: "/team", minutesAgo: 30 });
  }
  return items
    .sort((a, b) => a.minutesAgo - b.minutesAgo)
    .map((n, i) => ({ ...n, id: i + 1, read: i >= 2 }));
}

const ARRIVALS: Omit<Notification, "id" | "read" | "minutesAgo">[] = [
  { kind: "reply", text: "Your instructor replied to your question on Lesson 5", to: "/courses" },
  { kind: "comment", text: "Noor Ali asked a question on Lesson 2: Types", to: "/instructor/questions" },
  { kind: "refund-raised", text: "Kim Díaz asked for a refund on React Basics", to: "/admin/refunds" },
  { kind: "seat-claimed", text: "Raj Patel claimed a Seat on your Team Licence", to: "/team" },
];

function ago(m: number) {
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

type Store = {
  items: Notification[];
  unread: number;
  markRead: (id: number) => void;
  markAllRead: () => void;
};

function Row({ n, store, compact }: { n: Notification; store: Store; compact?: boolean }) {
  return (
    <Link
      to={n.to}
      onClick={() => store.markRead(n.id)}
      className={cn(
        "flex items-start gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent",
        !n.read && "bg-accent/50"
      )}
    >
      <span className="mt-0.5 text-muted-foreground">{KIND_ICON[n.kind]}</span>
      <span className="flex-1">
        <span className={cn("block", !n.read && "font-medium")}>{n.text}</span>
        {!compact && (
          <span className="text-xs text-muted-foreground">{ago(n.minutesAgo)}</span>
        )}
      </span>
      {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-500" />}
    </Link>
  );
}

// ─── A: bell in a top bar ───
function VariantA({ store, sidebar, outlet }: ShellParts) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {sidebar({})}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative flex h-14 shrink-0 items-center justify-end border-b px-6">
          <button onClick={() => setOpen(!open)} className="relative rounded-md p-2 hover:bg-accent" aria-label="Notifications">
            <Bell className="size-5" />
            {store.unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">
                {store.unread}
              </span>
            )}
          </button>
          {open && (
            <div className="absolute right-6 top-12 z-40 w-96 rounded-lg border bg-popover p-2 shadow-lg">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-sm font-semibold">Notifications</span>
                <button onClick={store.markAllRead} className="text-xs text-muted-foreground hover:underline">
                  Mark all read
                </button>
              </div>
              {store.items.slice(0, 5).map((n) => (
                <Row key={n.id} n={n} store={store} />
              ))}
              <div className="px-3 pt-2 text-xs text-muted-foreground">Showing the latest 5</div>
            </div>
          )}
        </header>
        <main className="flex-1 overflow-y-auto">{outlet}</main>
      </div>
    </>
  );
}

// ─── B: docked rail ───
function VariantB({ store, sidebar, outlet }: ShellParts) {
  const [open, setOpen] = useState(true);
  return (
    <>
      {sidebar({})}
      <main className="min-w-0 flex-1 overflow-y-auto">{outlet}</main>
      {open ? (
        <aside className="flex w-72 shrink-0 flex-col border-l">
          <div className="flex h-14 items-center justify-between border-b px-4">
            <span className="text-sm font-semibold">
              Activity {store.unread > 0 && <span className="ml-1 rounded-full bg-red-500 px-1.5 text-xs text-white">{store.unread}</span>}
            </span>
            <button onClick={() => setOpen(false)} aria-label="Collapse"><ChevronRight className="size-4" /></button>
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto p-2">
            {store.items.map((n) => (
              <Row key={n.id} n={n} store={store} />
            ))}
          </div>
        </aside>
      ) : (
        <button onClick={() => setOpen(true)} className="flex w-10 shrink-0 flex-col items-center gap-2 border-l pt-4" aria-label="Expand activity">
          <ChevronLeft className="size-4" />
          <Bell className="size-4" />
          {store.unread > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[10px] text-white">{store.unread}</span>}
        </button>
      )}
    </>
  );
}

// ─── C: sidebar entry that opens a full-page inbox ───
function VariantC({ store, sidebar, outlet }: ShellParts) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const shown = tab === "all" ? store.items : store.items.filter((n) => !n.read);
  return (
    <>
      {sidebar({
        extraNav: (
          <button
            onClick={() => setOpen(!open)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
              open ? "bg-sidebar-accent" : "text-sidebar-foreground/70 hover:bg-sidebar-accent"
            )}
          >
            <Inbox className="size-4" />
            Inbox
            {store.unread > 0 && (
              <span className="ml-auto rounded-full bg-red-500 px-1.5 text-xs font-semibold text-white">{store.unread}</span>
            )}
          </button>
        ),
      })}
      <main className="flex-1 overflow-y-auto">
        {open ? (
          <div className="mx-auto max-w-2xl p-8">
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-2xl font-bold">Inbox</h1>
              <button onClick={store.markAllRead} className="flex items-center gap-1 text-sm text-muted-foreground hover:underline">
                <Check className="size-4" /> Mark all read
              </button>
            </div>
            <div className="mb-3 flex gap-2 text-sm">
              {(["all", "unread"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={cn("rounded-full border px-3 py-1 capitalize", tab === t && "bg-accent")}>
                  {t}
                </button>
              ))}
            </div>
            <div className="divide-y rounded-lg border">
              {shown.length === 0 && <p className="p-6 text-sm text-muted-foreground">Nothing here.</p>}
              {shown.map((n) => (
                <Row key={n.id} n={n} store={store} />
              ))}
            </div>
          </div>
        ) : (
          outlet
        )}
      </main>
    </>
  );
}

// ─── D: no inbox, badges on the nav plus toasts ───
function VariantD({ store, sidebar, outlet }: ShellParts) {
  const badges: Record<string, number> = {};
  for (const n of store.items) {
    const to = KIND_NAV[n.kind];
    if (!n.read && to) badges[to] = (badges[to] ?? 0) + 1;
  }
  return (
    <>
      {sidebar({ badges })}
      <main className="flex-1 overflow-y-auto">{outlet}</main>
    </>
  );
}

type ShellParts = {
  store: Store;
  sidebar: (extra: { extraNav?: React.ReactNode; badges?: Record<string, number> }) => React.ReactNode;
  outlet: React.ReactNode;
};

const VARIANTS = {
  A: { name: "Bell dropdown", C: VariantA },
  B: { name: "Docked rail", C: VariantB },
  C: { name: "Full inbox page", C: VariantC },
  D: { name: "Nav badges + toasts", C: VariantD },
} as const;
type Key = keyof typeof VARIANTS;
const KEYS = Object.keys(VARIANTS) as Key[];

export function NotificationsPrototype({
  currentUser,
  isTeamAdmin,
  sidebar,
  outlet,
}: {
  currentUser: { role: UserRole } | null;
  isTeamAdmin: boolean;
  sidebar: ShellParts["sidebar"];
  outlet: React.ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const raw = params.get("variant") as Key | null;
  const variant: Key = raw && raw in VARIANTS ? raw : "A";
  const role = currentUser?.role ?? null;

  const [items, setItems] = useState(() => seed(role, isTeamAdmin));
  // reseed when the dev panel switches user
  useEffect(() => setItems(seed(role, isTeamAdmin)), [role, isTeamAdmin]);

  const store: Store = {
    items,
    unread: items.filter((n) => !n.read).length,
    markRead: (id) => setItems((xs) => xs.map((n) => (n.id === id ? { ...n, read: true } : n))),
    markAllRead: () => setItems((xs) => xs.map((n) => ({ ...n, read: true }))),
  };

  function simulateArrival() {
    const a = ARRIVALS[Math.floor(Math.random() * ARRIVALS.length)];
    setItems((xs) => [{ ...a, id: Date.now(), minutesAgo: 0, read: false }, ...xs]);
    if (variant === "D") toast(a.text);
  }

  function go(delta: number) {
    const next = KEYS[(KEYS.indexOf(variant) + delta + KEYS.length) % KEYS.length];
    setParams((p) => {
      p.set("variant", next);
      return p;
    }, { replace: true });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const V = VARIANTS[variant].C;
  return (
    <>
      <V store={store} sidebar={sidebar} outlet={outlet} />
      {!import.meta.env.PROD && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black px-4 py-2 text-sm text-white shadow-xl">
          <button onClick={() => go(-1)} aria-label="Previous"><ChevronLeft className="size-4" /></button>
          <span>{variant} ({VARIANTS[variant].name})</span>
          <button onClick={() => go(1)} aria-label="Next"><ChevronRight className="size-4" /></button>
          <button onClick={simulateArrival} className="rounded-full bg-white/20 px-3 py-0.5 hover:bg-white/30">
            + simulate new
          </button>
        </div>
      )}
    </>
  );
}
