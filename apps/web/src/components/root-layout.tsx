import { Outlet } from "react-router-dom"

import { AppRail } from "@/components/app-rail"

/** App frame: fixed rail + routed screen filling the rest of the viewport. */
export function RootLayout() {
  return (
    <div className="flex h-svh overflow-hidden bg-background text-foreground">
      <AppRail />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  )
}
