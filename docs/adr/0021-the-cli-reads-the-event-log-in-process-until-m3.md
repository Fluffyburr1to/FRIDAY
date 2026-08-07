# ADR-0021 — The CLI reads the event log in-process until M3

- **Status:** accepted
- **Date:** 2026-08-07
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [apps/cli/README.md](../../apps/cli/README.md),
  [Chapter 34 — Disaster Recovery](../01-bible/34-disaster-recovery.md),
  [Chapter 39 — Roadmap](../01-bible/39-roadmap.md)

---

## Context

[`apps/cli/README.md`](../../apps/cli/README.md) describes the CLI as "a terminal client over the
same tRPC API the apps use", connecting over a local Unix socket.

There is no such API at Milestone 1. `apps/core` — the service that would host it — arrives with the
Chief of Staff at Milestone 3. But `friday status`, `friday events tail`, and `friday verify` are
Milestone 1 deliverables, and they are how the milestone is demonstrated: the roadmap's stated
outcome is a live stream of events in a terminal, verified against the hash chain.

So the three commands need a way to read `events.db` with nothing else running.

There is a second consideration that outlasts Milestone 1. `apps/cli/README.md` rule 1 says the
recovery commands must work when everything else is broken. A tool that can only work by asking the
thing that is broken is not a recovery tool. Whatever the answer is for M1, some version of it should
survive M3.

## Decision

We will **have the CLI open `events.db` read-only, in-process, through `@friday/storage`**, for
`status`, `events tail`, and `verify`. `events emit` opens it for writing. When `apps/core` exists,
the read commands move to the API and the read-only path is retained as the fallback for recovery.

## Constitutional review

- **Article II (Transparency):** the point of the decision. Without it the milestone has nothing to
  look at, which the roadmap identifies as the largest risk to the project (R1).
- **Article IV (Privacy):** nothing leaves the machine. Reading a local file is if anything a smaller
  surface than a socket.
- **Article VI (Modularity):** the boundary is intact — the CLI goes through `@friday/storage` like
  everything else, and does not import a SQLite driver. `.dependency-cruiser.cjs` enforces that, and
  it caught an attempt to violate it in a test while this was being built.

**The five questions:**

- [x] **Can the user see it?** This is the command that lets them see anything.
- [x] **Can the user stop it?** Ctrl-C. The tail is the only long-running command and it aborts
      cleanly.
- [x] **Can we replace it?** The commands are three functions taking a context; swapping the reader
      for an API client does not change their output.
- [x] **Can we explain it?** Yes.
- [ ] **Will this still be right in five years?** **No, and deliberately.** This is a
      milestone-scoped decision with a stated end. Recorded here so the future reader knows it was a
      choice rather than an oversight.

**Notes:** The unchecked box is the honest one. The read-only path should survive as the recovery
fallback; the *default* routing through it should not.

## Alternatives considered

### Wait for `apps/core` and ship the CLI at M3

**What it is.** Build the kernel and storage at M1, and give them a user interface two milestones
later.

**Advantages.** No throwaway work. One code path instead of two. Matches the README as written.

**Why rejected.** It would leave Milestone 1 with no demonstrable outcome, and the roadmap is
explicit that a milestone ending in nothing demonstrable is re-scoped rather than extended (rule 4).
Six months between M0 and M4 with nothing to look at is named as the single greatest risk to the
project, and this is one of the deliberate inefficiencies that exists to manage it.

### Build a minimal socket server at M1 for the CLI to talk to

**What it is. ** A small daemon that owns the database and answers three queries.

**Advantages.** The CLI's architecture would match its README from the start, and there would be one
reader of the database rather than two.

**Why rejected.** It is `apps/core` under another name, built before the design that shapes it
exists, and it would have to be thrown away or grown into something it was not designed for. It also
inverts the recovery property: a status command that needs a daemon cannot tell you why the daemon
will not start.

### Have the CLI shell out to `sqlite3`

**What it is.** Read the log with the system SQLite binary and parse its output.

**Advantages.** No dependency on `@friday/storage` at all, so genuinely nothing to break.

**Why rejected.** It would put SQL in `apps/cli`, which is exactly what the "only storage opens the
database" rule exists to prevent, and it would need the field-decryption logic duplicated. The
boundary is worth more than the independence.

## Consequences

**Positive**

- Milestone 1 has a demonstrable outcome: emit in one terminal, watch in another, verify the chain.
- The recovery commands work with nothing else running, which is what Chapter 34 asks for.
- WAL mode means the reader never blocks the kernel writing, and this is tested.

**Negative**

- **Two code paths will exist after M3**, and the read-only one will be exercised rarely. Rarely
  exercised recovery code is the kind that is broken when you need it, so it needs a test that keeps
  running after it stops being the default.
- The tail polls every 400 ms rather than being pushed to, so an event can appear up to 400 ms late.
  Imperceptible to a person, wrong for anything automated.
- `apps/cli/README.md` describes an architecture that does not exist yet. The README was left as the
  statement of intent and this ADR is the record of the interim; someone reading only the README will
  be surprised.

**Neutral**

- `apps/cli` depends on `@friday/storage` and `@friday/kernel`. Both are workspace packages the
  boundary rules already permit, though it makes the CLI's dependency list longer than rule 1 of its
  README would like.

## Reversibility

- **Cost to reverse:** low.
- **How:** replace the body of `createContext` with an API client. The command functions take a
  context and produce output; they do not know where the events came from.
- **Point of no return:** none.

## Review triggers

- `apps/core` ships (Milestone 3) — move `status`, `events tail`, and `verify` onto the API and keep
  the read-only path as the documented fallback.
- The tail's polling interval becomes visible in use.
- Anything other than a person starts consuming `events tail` output.

## Notes

`events emit` is the one Milestone 1 command that opens the log for writing, and it exists so the
tail has something to show. It should be re-examined at M3: once a real service is publishing events,
a CLI that can write directly to the log is a way to record something FRIDAY did not do.
