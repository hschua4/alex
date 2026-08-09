/**
 * Renders scripts/og-image.html into public/og.png (1200×630, the size every
 * unfurler asks for) with headless Chrome — no image binary in the toolchain,
 * and the card stays editable as HTML.
 *
 *   pnpm --filter @alex/web og
 *
 * Chrome is found at the macOS default; override with CHROME=/path/to/chrome
 * on other machines.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, copyFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, "og-image.html")
const output = join(here, "..", "public", "og.png")

const chrome =
  process.env.CHROME ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

const scratch = mkdtempSync(join(tmpdir(), "alex-og-"))
const shot = join(scratch, "og.png")

try {
  try {
    execFileSync(
      chrome,
      [
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        "--force-color-profile=srgb",
        // The card loads its fonts from node_modules over file://.
        "--allow-file-access-from-files",
        "--window-size=1200,630",
        // Fonts are font-display: block, so give layout a beat to settle.
        "--virtual-time-budget=3000",
        `--user-data-dir=${join(scratch, "profile")}`,
        `--screenshot=${shot}`,
        source,
      ],
      { stdio: "inherit", timeout: 60_000 }
    )
  } catch (err) {
    // Headless Chrome sometimes writes the shot and then lingers until the
    // timeout kills it. A written file is a successful render.
    if (!existsSync(shot)) throw err
  }

  copyFileSync(shot, output)
  console.log(`wrote ${output}`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
