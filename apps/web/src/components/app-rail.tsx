import { LayoutGrid, LogOut, Search, Settings } from "lucide-react"
import { NavLink, useNavigate } from "react-router-dom"

import { signOut, useSession } from "@/lib/auth-client"
import { useHealth } from "@/lib/use-health"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/** Fixed 60px navigation rail — dark in both themes. */
export function AppRail() {
  return (
    <nav className="flex w-[60px] shrink-0 flex-col items-center gap-2 bg-rail py-4">
      <div className="mb-3.5 flex size-[34px] items-center justify-center rounded-[9px] bg-primary text-base font-extrabold text-primary-foreground">
        R
      </div>

      <RailLink to="/" label="Projects" icon={LayoutGrid} end />
      <RailButton label="Search" icon={Search} />

      <div className="flex-1" />

      <RailHealthDot />
      <RailButton label="Settings" icon={Settings} />
      <RailUser />
    </nav>
  )
}

/** Signed-in identity + sign-out — proof the workspace is this user's own. */
function RailUser() {
  const { data: session } = useSession()
  const navigate = useNavigate()
  const user = session?.user

  async function handleSignOut() {
    await signOut()
    navigate("/login", { replace: true })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={user?.email ?? "Account"}
        aria-label={user ? `Signed in as ${user.email}` : "Account"}
        className="mt-1 flex size-[34px] items-center justify-center rounded-full text-[13px] font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-white/60 [background:oklch(0.62_0.13_45)]"
      >
        {initials(user?.name, user?.email)}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={8}>
        <div className="max-w-56 px-1.5 py-1">
          <p className="truncate text-sm font-medium">
            {user?.name ?? "Signed in"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {user?.email}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Up-to-two-letter avatar initials from a name, falling back to the email. */
function initials(name?: string, email?: string): string {
  const source = name?.trim() || email?.split("@")[0] || "?"
  const parts = source.split(/\s+/).filter(Boolean)
  const letters =
    parts.length >= 2 ? parts[0][0] + parts[1][0] : source.slice(0, 2)
  return letters.toUpperCase()
}

/** Live API/DB connection indicator, driven by the real /api/health RPC call. */
function RailHealthDot() {
  const { data, isLoading, isError } = useHealth()
  const ok = data?.status === "ok"
  const state = isLoading
    ? "pending"
    : isError || !ok
      ? "down"
      : "up"
  const color =
    state === "up"
      ? "var(--success)"
      : state === "down"
        ? "var(--destructive)"
        : "var(--warning)"
  const title =
    state === "up"
      ? `API connected · schema ${data?.schemaVersion ?? "?"} · ${data?.latencyMs ?? "?"}ms`
      : state === "down"
        ? "API unreachable"
        : "Checking API…"

  return (
    <div
      className={itemBase}
      title={title}
      aria-label={title}
      role="status"
    >
      <span
        className="size-2.5 rounded-full transition-colors"
        style={{ background: color }}
      />
    </div>
  )
}

const itemBase =
  "flex size-[38px] items-center justify-center rounded-[10px] transition-colors"

function RailLink({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string
  label: string
  icon: typeof LayoutGrid
  end?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      aria-label={label}
      className={({ isActive }) =>
        cn(
          itemBase,
          isActive
            ? "bg-rail-active text-white"
            : "text-rail-foreground hover:bg-rail-active/50 hover:text-white"
        )
      }
    >
      <Icon className="size-[19px]" strokeWidth={2} />
    </NavLink>
  )
}

function RailButton({
  label,
  icon: Icon,
}: {
  label: string
  icon: typeof LayoutGrid
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        itemBase,
        "text-rail-foreground hover:bg-rail-active/50 hover:text-white"
      )}
    >
      <Icon className="size-[19px]" strokeWidth={2} />
    </button>
  )
}
