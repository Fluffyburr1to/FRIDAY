# 20 — API Standards

> **Governing provisions:** Constitution Article II (Transparency), Article VI (Modularity), Article
> VII (Reliability); Manifesto Principle 5 (Modularity), Principle 9 (Fail Gracefully), Principle 10
> (Simplicity Wins); Core Value 9 (Document Everything).

---

## In plain language

An API is the doorway software uses to talk to FRIDAY. The desktop app uses one. The phone uses one.
The command line uses one. Eventually other programs will.

The central decision here is about **where the definition of that doorway lives**.

In most projects, the shape of the data is described several times: once in the server, once in the
client, once in the documentation, and once in the mobile app. They start identical and drift. Six
months later the documentation says a field is optional, the server requires it, and the phone app
sends the wrong type. Nobody notices until something breaks at an unhelpful moment.

FRIDAY defines each shape **exactly once**, in `packages/contracts`, using Zod. Everything else —
the server's validation, the TypeScript types on every client, the API documentation, the forms in
the dashboard — is derived mechanically from that one definition. They cannot drift, because there
is only one of them.

This is not an elegance argument. It is a survival argument for a project maintained by one person
with AI assistance across years. Drift is what makes an old codebase dangerous to change, and this
eliminates an entire category of it.

---

## Two APIs, deliberately

| API | Consumers | Technology | Stability |
|---|---|---|---|
| **Internal** | Desktop, mobile, web, CLI — all first-party | **tRPC** over HTTP + WebSocket | Evolves freely with the apps |
| **External** | Third-party software, scripts, future integrations | **REST + OpenAPI 3.1**, generated from the same Zod schemas | **Versioned and stable** |

### Why two rather than one

A single API forces a bad trade. Optimize it for first-party clients and it becomes hard for
outsiders to use. Optimize it for outsiders — stable, versioned, conservative — and every internal
change becomes a breaking-change negotiation with yourself.

Splitting them means the internal API can change in the same commit as the app that uses it (the
monorepo advantage from [Chapter 04](04-monorepo-vs-multirepo.md)), while the external API stays a
deliberate, versioned promise.

**The external API is deferred to M8.** It is designed now — the generation path from Zod to OpenAPI
is established early — but no external surface is published until there is something to consume it.
Publishing an API is a promise, and promises made before the architecture settles are expensive.

---

## The internal API: tRPC

### Why tRPC

The client and server share types directly, with no code generation step and no schema file to keep
in sync. Calling a procedure that does not exist, or passing the wrong argument shape, is a compile
error — caught before you ever run anything.

For AI-assisted development this is worth an unusual amount. When an assistant invents an endpoint,
misremembers a parameter, or forgets that a field is optional, the build fails with a precise
message. Without it, those mistakes surface at runtime as confusing behavior, which you — not
reading code — would have to diagnose from a symptom.

### Structure

```
appRouter
├── plans        list · get · create · cancel · explain
├── approvals    pending · get · respond · grants.*
├── memory       search · get · forget · browse
├── audit        stream · query · explain
├── departments  list · status · enable · disable
├── connectors   list · status · authorize · revoke · test
├── system       health · diagnostics · config · safeMode
└── voice        transcribe · synthesize
```

Rules:

1. **Every procedure declares input and output Zod schemas.** No untyped procedures.
2. **Queries read; mutations write.** Never a mutation disguised as a query.
3. **Every mutation is authorized by the Guardian** before executing — no exceptions, including
   ones that "obviously" do not need it.
4. **Every mutation is idempotent or carries an idempotency key.** Retries must not duplicate work.
5. **Subscriptions stream events** over WebSocket for anything live.

### Errors

Errors are structured data, not strings:

```
{
  "code": "APPROVAL_REQUIRED",
  "message": "This action needs your approval",       ← plain language, for the user
  "detail": "connector.gmail.send is medium risk",    ← for the developer
  "correlationId": "01J8XKQ...",                      ← ties to the audit trail
  "retryable": false,
  "approvalId": "01J8XKR..."
}
```

Every error carries a **plain-language message** and a **correlation ID**. The message is what a
person sees; the correlation ID is what makes it diagnosable — paste it into the dashboard and see
the complete causal chain that produced it. Principle 9: "when something fails, FRIDAY should detect
it, isolate it, explain it."

Error codes are a closed enumeration in `packages/contracts`. New codes require adding to the enum,
which means every client is compile-checked against the complete set.

---

## The external API: REST + OpenAPI

Generated from the same Zod schemas, so it cannot describe something the server does not do.

| Standard | Rule |
|---|---|
| Versioning | URL path: `/api/v1/`. A new major version only for breaking changes. |
| Format | JSON. `application/json` only. |
| Naming | Plural resource nouns, `kebab-case` paths, `camelCase` fields |
| Errors | **RFC 9457 Problem Details** — the standard, not a bespoke shape |
| Pagination | Cursor-based, never offset. Offset pagination breaks when data changes mid-iteration. |
| Idempotency | `Idempotency-Key` header supported on all writes |
| Rate limiting | `RateLimit` headers per RFC 9238 |
| Time | ISO 8601, UTC, always. Never a local time without an offset. |
| IDs | UUIDv7 as strings — sortable by creation time, no integer overflow, no enumeration |
| Auth | Bearer tokens, scoped, expiring |
| Docs | OpenAPI 3.1 generated in CI; drift from the implementation fails the build |

**Every external API action passes through the Guardian, exactly like an internal one.** An external
caller does not get a shortcut around Article III. If it triggers a `high` risk action, an approval
request appears on your devices and the API returns `202 Accepted` with a pending approval ID.

That last behavior is unusual and worth stating: **the external API can block on human approval**,
returning a pending state rather than either failing or acting without consent. Anything else would
make the external API a hole in the Constitution.

---

## Versioning and change

### What counts as breaking

| Breaking | Non-breaking |
|---|---|
| Removing a field or endpoint | Adding an optional field |
| Making an optional field required | Adding an endpoint |
| Changing a field's type | Adding an enum value **to output only** |
| Adding an enum value to **input** | Loosening validation |
| Changing an error code's meaning | Adding an error code |
| Tightening validation | Performance improvements |

Adding an enum value to an input is breaking and to an output is not — old clients can send only
what they know, but they must tolerate receiving something new. This asymmetry is a classic source
of accidental breakage and is worth having written down.

### Deprecation

1. Mark deprecated in the schema, with a replacement named and a removal date
2. `Deprecation` and `Sunset` headers on responses
3. Usage logged, so you know whether anything still calls it
4. Minimum 90 days before removal
5. Removal in a major version only

**Internally, deprecation is unnecessary** — the monorepo means you change the caller in the same
commit. This is entirely for external consumers, which is why it does not exist until M8.

---

## Alternatives considered

### GraphQL

**Advantages:** clients request exactly the fields they need; one endpoint; excellent tooling;
strongly typed schema.

**Rejected** because it solves a problem we do not have: many independent client teams with
divergent data needs. We have one team writing all clients. GraphQL's costs are real — N+1 query
management, query complexity limits to prevent abuse, caching that is much harder than HTTP's, and a
substantial server-side runtime. tRPC gives equivalent type safety for a fraction of the machinery.
Principle 10.

### REST only, for both internal and external

**Advantages:** one API to maintain; universally understood; no tRPC dependency.

**Rejected** because internal clients would lose end-to-end type inference, which is the single
highest-value property in this stack for AI-assisted development. It would also force every internal
change through versioning ceremony that the monorepo makes unnecessary.

### gRPC / Protocol Buffers

**Advantages:** excellent performance, strong schemas, first-class streaming, good cross-language
support.

**Rejected** because browser support requires a proxy layer (gRPC-Web), the tooling adds a
code-generation step to every build, and the performance advantage is irrelevant for local
communication at FRIDAY's volume. Worth revisiting only if a non-TypeScript component ever needs a
first-class API.

### tRPC for everything, including external

**Rejected** because tRPC is TypeScript-specific and not a documented wire protocol. An external
consumer writing Python or Go would have nothing to work with. External APIs must be
language-neutral.

### OpenAPI-first (write the spec, generate the code)

**Advantages:** the specification is unambiguously the source of truth; excellent tooling; standard
practice in larger organizations.

**Rejected** because it adds a code-generation step to every change and makes the spec a separate
artifact that can drift from intent. Zod-first gives us runtime validation, static types, and a
generated spec from a single definition — the same benefit with fewer steps. The direction of
generation matters less than there being exactly one source.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Two APIs is more surface** than one. | Accepted — they serve genuinely different consumers, and the external one is deferred until it has users. |
| **tRPC is TypeScript-only** — a real lock-in to the language. | Accepted; it is already the stack-wide decision, and the external REST API is the escape hatch. |
| **Zod validation costs CPU** on every request. | Accepted — validate at boundaries only, measured against Chapter 35 budgets. |
| **Generated OpenAPI is sometimes less idiomatic** than a hand-written spec. | Accepted — correctness and non-drift beat elegance. |
| **Guardian evaluation on every mutation adds latency** (~1–3ms). | Accepted — it is the safety model. |
| **`202 Accepted` with a pending approval is unusual** and will confuse some external consumers. | Accepted — documented prominently. Any other behavior would violate Article III. |

---

## Review triggers

- A non-TypeScript first-party component appears → reconsider the internal transport
- External consumers materialize → the external API moves from deferred to real, with a versioning
  commitment
- tRPC releases a breaking major version → assess migration cost
- Request latency exceeds the Chapter 35 budget → profile validation overhead
- An external consumer requires GraphQL-style field selection → reassess

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
