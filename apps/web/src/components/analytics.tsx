import { useEffect } from "react"
import { useLocation } from "react-router-dom"

/**
 * Umami pageview tracking for the public marketing surface only.
 *
 * The app's own routes carry project and chat ids in the path
 * (`/p/:projectId/chat/:chatId`), and this is a product people point at their
 * own documents — those urls are not ours to ship to a third party. So the
 * tracker is loaded lazily, on the first tracked route a visitor lands on, with
 * Umami's auto-tracking switched off: it never installs a history listener, and
 * a navigation into /app sends nothing. Signed-in visitors are redirected off
 * "/" before it paints, so in practice this measures anonymous traffic.
 *
 * Configured at build time by VITE_UMAMI_WEBSITE_ID (see env.d.ts). Unset in
 * dev, so `pnpm dev` never pollutes the stats.
 */

const WEBSITE_ID = import.meta.env.VITE_UMAMI_WEBSITE_ID
const SCRIPT_SRC =
  import.meta.env.VITE_UMAMI_SRC ?? "https://cloud.umami.is/script.js"

const TRACKED_PATHS = new Set(["/", "/login"])

declare global {
  interface Window {
    umami?: { track: () => void }
  }
}

/** Injected at most once; a rejection is remembered so a blocked script is not retried. */
let tracker: Promise<void> | null = null

function loadTracker(): Promise<void> {
  tracker ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = SCRIPT_SRC
    script.defer = true
    script.dataset.websiteId = WEBSITE_ID!
    script.dataset.autoTrack = "false"
    script.addEventListener("load", () => resolve())
    script.addEventListener("error", () =>
      reject(new Error("umami tracker failed to load"))
    )
    document.head.append(script)
  })
  return tracker
}

export function Analytics() {
  const { pathname } = useLocation()

  useEffect(() => {
    if (!WEBSITE_ID || !TRACKED_PATHS.has(pathname)) return

    let active = true
    loadTracker().then(
      () => {
        if (active) window.umami?.track()
      },
      // Blocked by an extension, offline, DNS-filtered: analytics is never
      // allowed to surface as an error on the page.
      () => {}
    )

    return () => {
      active = false
    }
  }, [pathname])

  return null
}
