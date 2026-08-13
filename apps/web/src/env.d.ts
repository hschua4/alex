/// <reference types="vite/client" />

/**
 * Build-time configuration baked into the SPA bundle. These are public values
 * (they ship to every browser) — never put a credential behind a VITE_ prefix.
 */
interface ImportMetaEnv {
  /**
   * Umami Cloud website id. Unset — the default in dev and in any image built
   * without the build-arg — means no tracker is loaded at all.
   */
  readonly VITE_UMAMI_WEBSITE_ID?: string
  /** Tracker origin. Only set this when self-hosting Umami. */
  readonly VITE_UMAMI_SRC?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
