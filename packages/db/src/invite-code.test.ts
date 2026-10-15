import { describe, expect, it } from "vitest"

import { generateInviteCode, normalizeInviteCode } from "./invite.ts"

describe("invite codes", () => {
  it("generates XXXX-XXXX codes without look-alike symbols", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateInviteCode()).toMatch(
        /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/,
      )
    }
  })

  it("forgives case, spaces, and a missing dash", () => {
    expect(normalizeInviteCode(" abcd-efgh ")).toBe("ABCD-EFGH")
    expect(normalizeInviteCode("abcdefgh")).toBe("ABCD-EFGH")
    expect(normalizeInviteCode("ABCD EFGH")).toBe("ABCD-EFGH")
  })

  it("leaves wrong-length input alone so it simply won't match", () => {
    expect(normalizeInviteCode("abc")).toBe("ABC")
  })
})
