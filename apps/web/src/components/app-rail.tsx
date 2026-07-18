import { LayoutGrid, Search, Settings } from "lucide-react"
import { NavLink } from "react-router-dom"

import { cn } from "@/lib/utils"

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

      <RailButton label="Settings" icon={Settings} />
      <div className="mt-1 flex size-[34px] items-center justify-center rounded-full text-[13px] font-bold text-white [background:oklch(0.62_0.13_45)]">
        AK
      </div>
    </nav>
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
