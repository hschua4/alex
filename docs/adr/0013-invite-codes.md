# ADR-0013 — Expiring invite codes alongside the email allowlist

**Status:** Accepted

## Context

v1 is invite-only ([ADR-0011](./0011-cost-and-abuse-controls.md)), and the only
way in was allowlisting an exact email. That works when the operator knows who
is signing up. It doesn't work when access is handed to someone whose address
isn't known in advance, such as a hiring panel that wants to try the app. It
also leaves no way to grant access that lapses on its own: an allowlisted email
stays open until it's used.

## Decision

**Add shareable invite codes that expire, next to the email allowlist.**

- An operator mints a code with `pnpm invite code [--days 7] [--uses 1]
  [--label "…"]`. Codes are `XXXX-XXXX`, drawn from an alphabet without look-alike
  characters (no I/L/O/0/1): about 40 bits, so they can be read aloud and
  aren't guessable. The CLI also prints a sign-up link,
  `/login?code=XXXX-XXXX`, which opens the register form with the code
  filled in.
- **Expiry gates sign-up only.** After `expires_at`, or once `uses` reaches
  `max_uses`, or after `pnpm invite revoke`, the code admits no new accounts.
  Accounts already created with it keep full access, like any other member.
- **The gate stays in one place**: better-auth's `user.create.before` hook. An
  allowlisted email passes as before. Otherwise the sign-up body must carry a
  code, which is **claimed atomically** with a single conditional `UPDATE …
  WHERE uses < max_uses AND expires_at > now() AND revoked_at IS NULL`, so
  sign-ups racing for a code's last use can't both win. A refused code gets a
  specific message: invalid, expired, revoked, or already used.
- The code a user registered with is stored on `user.invite_code` as a record
  of how they got in. It is never checked again.

This change also implements ADR-0011's per-user chat rate limit, which had not
been built: an in-memory fixed window (30 turns per 10 minutes) on chat and
regenerate, applied after request validation so malformed requests don't
count against the limit.

## Alternatives considered

- **Email allowlist only.** Rejected. The operator has to know every address
  in advance, and access never lapses on its own.
- **Open public demo with throwaway accounts.** Considered and dropped.
  Reviewers should get the full product, including uploads, not a read-only
  copy of sample data.
- **Accounts that expire along with the code.** Rejected for now. Locking out
  someone mid-evaluation is worse than the cost exposure, which the per-user
  rate limit and upload caps already bound.
- **better-auth's invitation/organization plugins.** Rejected. They model
  organization membership, which Alex doesn't have. A small table and one
  hook are less to reason about.

## Consequences

- One code can cover a whole panel (`--uses 5`) and stops working by itself
  after the chosen window.
- A claimed use isn't refunded if account creation fails after the hook,
  which is rare (for example, a database error on insert). The operator can
  mint another code.
- Revoking a code doesn't remove accounts created with it. To cut off access,
  delete those accounts; `user.invite_code` shows which ones they are.
