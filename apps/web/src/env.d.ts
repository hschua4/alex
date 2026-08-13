/// <reference types="vite/client" />

/**
 * Build-time configuration baked into the SPA bundle. These are public values
 * (they ship to every browser) — never put a credential behind a VITE_ prefix.
 */
interface ImportMetaEnv {
  /**
   * Website id from the self-hosted Umami at analytics.hschua.com. Unset — the
   * default in dev and in any image built without the build-arg — means no
   * tracker is loaded at all.
   */
  readonly VITE_UMAMI_WEBSITE_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
