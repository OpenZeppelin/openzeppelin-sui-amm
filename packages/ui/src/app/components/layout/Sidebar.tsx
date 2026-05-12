"use client"

import {
  Activity,
  Bot,
  CircleDollarSign,
  LayoutDashboard,
  Plus,
  Settings,
  type LucideIcon
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

type NavItem = {
  href: string
  label: string
  icon: LucideIcon
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/config", label: "Configuration", icon: Settings },
  { href: "/performance", label: "Performance", icon: Activity },
  { href: "/bot", label: "Bot Status", icon: Bot },
  { href: "/funding", label: "Funding", icon: CircleDollarSign }
]

// Routes back to the setup page so the user can switch between owned
// executors or create a new one. Kept separate from `NAV_ITEMS` so the
// "active page" highlight only applies to terminal sections.
const SETUP_HREF = "/"

const isActiveHref = (pathname: string | null, href: string) => {
  if (!pathname) return false
  if (pathname === href) return true
  return pathname.startsWith(`${href}/`)
}

const Sidebar = () => {
  const pathname = usePathname()

  return (
    <aside className="flex w-[220px] shrink-0 flex-col gap-2 self-start rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70">
      <div className="px-2 pb-2 text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-200/60">
        Terminal
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActiveHref(pathname, item.href)
          const Icon = item.icon
          const className = [
            "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
            active
              ? "border-sds-blue/20 bg-sds-blue/10 text-sds-blue dark:border-sds-blue/30 dark:bg-sds-blue/20"
              : "border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/50"
          ].join(" ")

          return (
            <Link key={item.href} href={item.href} className={className}>
              <Icon size={16} aria-hidden />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
      <div className="mt-2 border-t border-slate-200/60 pt-3 dark:border-slate-50/15">
        <Link
          href={SETUP_HREF}
          className="border-sds-blue/30 hover:bg-sds-blue/10 dark:border-sds-blue/40 dark:hover:bg-sds-blue/20 flex items-center gap-2.5 rounded-lg border border-dashed px-3 py-2 text-sm font-medium text-sds-blue transition-colors"
        >
          <Plus size={16} aria-hidden />
          <span>New executor</span>
        </Link>
      </div>
    </aside>
  )
}

export default Sidebar
