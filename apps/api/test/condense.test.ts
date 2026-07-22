import { describe, expect, it } from "vitest"

import {
  createOpenRouterCondenser,
  createPassthroughCondenser,
} from "../src/chat/index.ts"

/**
 * Condenser behavior that needs no model call (CONTEXT §4.3): the passthrough
 * default, and the first-turn short-circuit that must return the question
 * *before* reaching for the network. The real rewrite path runs against a live
 * model only in the opt-in eval suite (ADR-0012), never in the CI gate.
 */
describe("condenser", () => {
  it("passthrough returns the question verbatim", async () => {
    const condense = createPassthroughCondenser()
    const out = await condense.condense({
      question: "what about its pricing?",
      history: [{ role: "user", content: "tell me about widgets" }],
    })
    expect(out).toBe("what about its pricing?")
  })

  it("skips the model on empty history — a first turn is already standalone", async () => {
    // The apiKey is never used: empty history short-circuits before any call, so
    // this proves the first-message gate without touching the network.
    const condense = createOpenRouterCondenser({ apiKey: "unused" })
    const out = await condense.condense({
      question: "standalone question",
      history: [],
    })
    expect(out).toBe("standalone question")
  })
})
