# 15 — Plugin System

> **Governing provisions:** Constitution Article V (Security), Article VI (Modularity), Article III
> (Approval); Manifesto Principle 5 (Modularity Creates Freedom), Principle 6 (Architecture Is
> Sacred); Long-Term Vision ("future technologies that do not yet exist").

---

## In plain language

A plugin is an extension to FRIDAY written by someone who is not you — or by you, but distributed
separately from her core code.

This chapter is about a capability FRIDAY will not have for years. That is intentional, and I want
to explain why it is in the Bible now rather than later.

Your Long-Term Vision says FRIDAY should support "future technologies that do not yet exist." The
only way software supports things that do not yet exist is by being extensible by people other than
its author. So a plugin system is eventually required.

But a plugin system is also the single most dangerous feature you can add to a system like FRIDAY.
A plugin is code you did not write, running on the machine that holds your email, your finances,
your home controls, and your private notes. Every property the rest of this Bible establishes —
mediated actions, audited events, approval gates, minimum disclosure — has to survive contact with
code whose author you have never met and whose intentions you cannot verify.

**Designing that boundary after the fact is not possible.** If departments and connectors are built
assuming they are trustworthy first-party code, then the day a third-party one arrives, every
assumption in the system is quietly wrong. So the design is settled now, the architecture is built
to accommodate it now, and the feature ships much later.

The core decision:

> **Third-party plugins are never trusted. They run in a real sandbox, with no ambient authority, and
> everything they do passes through the same Guardian as everything else — with an additional layer
> of restriction on top.**

---

## Recommendation

A **capability-based, sandboxed plugin system** with signed manifests, explicit user-granted
permissions, and process-level isolation — designed now, specified now, **implemented no earlier
than Milestone 8**.

### Three trust tiers

The system distinguishes what it is running by origin, and treats them differently.

| Tier | Origin | Isolation | Permissions | Review |
|---|---|---|---|---|
| **Core** | This repository | In-process | Full, per manifest | Owner-reviewed PR |
| **Verified** | Written by you, distributed separately | Worker thread | Per manifest, user-granted | Owner-signed |
| **Community** | Anyone | **Separate process, sandboxed** | Per manifest, user-granted, **restricted set** | Signature + install-time review |

The critical row is the third. Community plugins get:

- **A separate OS process**, not a worker thread. [Chapter 11](11-agent-framework.md) is explicit
  that worker threads are isolation, not security. For untrusted code, that is not sufficient.
- **A restricted permission set.** Some capabilities are simply not available to community plugins
  at any permission level, regardless of what the user grants.
- **No `critical` risk class, ever.** A community plugin cannot request an action classified
  `critical`. Not "requires approval" — unavailable.
- **A hard egress allowlist**, same mechanism as connectors ([Chapter 14](14-connector-framework.md)).

### What community plugins may never do

This list exists so that no future user permission, however enthusiastically granted, can produce
these outcomes:

- Modify FRIDAY's own code, configuration, or the Guardian's policies
- Read or write the event log directly
- Access credentials for any connector they did not themselves provide
- Read memory tagged `secret`, or `private` without explicit per-category grant
- Register new risk classes or alter risk classification
- Grant themselves permissions, or create standing grants
- Suppress, batch, or modify notifications
- Access another plugin's data
- Make network requests to hosts outside their declared allowlist
- Perform actions classified `critical`

**These are enforced in the kernel, not in the plugin host.** A plugin host bug should not be able
to open any of these doors.

### The manifest

```
{
  "id": "com.example.weather-plus",
  "version": "1.2.0",
  "tier": "community",
  "author": { "name": "...", "publicKey": "..." },
  "signature": "...",              ← over the whole package
  "friday": { "minVersion": "2.0.0" },

  "permissions": [
    { "id": "network.egress",
      "hosts": ["api.weather.example.com"],
      "justification": "Fetch forecast data" },
    { "id": "memory.read",
      "namespace": "weather",
      "justification": "Recall your saved locations" },
    { "id": "notification.send",
      "maxUrgency": "normal",
      "justification": "Severe weather alerts" }
  ],

  "provides": {
    "capabilities": [...],
    "connectors":  [...],
    "uiPanels":    [...]
  },

  "dataCategories": ["location_coarse"],
  "riskClassCeiling": "medium"      ← may never exceed; capped for community tier
}
```

**Every permission requires a written justification, shown to you at install.** You approve
permissions individually, not as a block. "This plugin wants to reach api.weather.example.com
because it fetches forecast data" is a decision you can actually make. "This plugin requires
network access" is not.

---

## Installation

```
1.  You provide a plugin package
2.  SIGNATURE VERIFIED   — unsigned packages are refused outright
3.  MANIFEST VALIDATED   — schema, version compatibility, permission legality
4.  STATIC ANALYSIS      — scan for known-dangerous patterns (eval, dynamic
                           require, obfuscation, process spawning)
5.  PERMISSION REVIEW    — shown to you, one at a time, with justifications,
                           in plain language, with what each actually allows
6.  YOU APPROVE          — individually. Declining one does not block install;
                           the plugin runs with less, or reports it cannot.
7.  SANDBOX PREPARED     — process, permission set, egress allowlist
8.  TRIAL PERIOD         — 7 days. Every action logged prominently in the
                           dashboard. A summary at the end asks whether to keep it.
9.  ACTIVE               — with permissions reviewable and revocable at any time
```

**The trial period is the mechanism I would most defend if it were questioned.** Reviewing
permissions at install is genuinely hard — you do not yet know what the plugin will actually do with
them. Seven days of highly visible activity, followed by a plain-language summary ("this plugin made
340 requests to api.weather.example.com and read your location 12 times — keep it?"), is a decision
made with real information rather than speculation.

Installing a plugin is itself a `high` risk-class action requiring approval, and it is recorded
permanently in the audit log.

---

## Runtime enforcement

```
┌────────────────────────────────────────────────────────┐
│  friday-core                                           │
│                                                        │
│   Plugin Host                                          │
│    · owns the sandbox process                          │
│    · translates plugin requests into kernel requests    │
│    · attaches plugin identity to EVERY request          │
│    · enforces per-plugin rate and resource budgets      │
│                                                        │
│         ▲  typed IPC, structured messages only         │
└─────────┼──────────────────────────────────────────────┘
          │
   ┌──────▼──────────────────────────────┐
   │  Sandboxed process                  │
   │                                     │
   │  · restricted permission set        │
   │  · no ambient filesystem access     │
   │  · no ambient network access        │
   │  · memory and CPU ceilings          │
   │  · no access to parent environment  │
   └─────────────────────────────────────┘
```

Every request from a plugin carries its identity, and the Guardian evaluates it against **both** the
action's normal policy **and** the plugin's granted permissions. Both must allow. A plugin cannot
exceed its grant even for an action that would otherwise be permitted, and a granted permission
does not bypass normal policy.

**Resource ceilings prevent the denial-of-service case:** a plugin exceeding its CPU, memory, or
request budget is suspended, you are notified once, and FRIDAY continues. A misbehaving plugin
degrades itself, never the system.

---

## Why this is deferred to M8

Three reasons, in order of weight.

**1. There is nothing to extend yet.** A plugin system for a system with three departments is
machinery without users. Build it when the surface it extends is stable, or you will be maintaining
compatibility with an API that was wrong.

**2. It multiplies the security surface at the worst possible time.** The years before M8 are when
the core safety model is being proven. Adding untrusted code before you trust your own code is
backwards.

**3. The API must be stable before it is public.** A published plugin API is a promise. Making that
promise before the architecture has settled means either breaking third-party plugins repeatedly or
freezing an immature design. Neither is acceptable under Principle 6.

**What we do now instead:** the manifest format, the permission model, the capability declarations,
and the process-isolation support in the agent runtime are all designed and built into the
architecture from the start. Departments and connectors already use manifest-declared permissions.
When plugins arrive, they are a new *trust tier* over existing machinery, not a new subsystem.

That is the whole reason this chapter exists at Milestone 0.

---

## Alternatives considered

### No plugin system, ever

**Advantages:** dramatically smaller attack surface, less code, no compatibility obligations.

**Rejected** because the Long-Term Vision explicitly anticipates supporting technologies that do not
exist yet, and because a single person cannot write every integration a decades-long system will
want. Refusing extensibility means FRIDAY's growth is permanently capped at your available hours.

### Plugins as full trusted code (the VS Code model)

VS Code extensions run with essentially the same privileges as the editor.

**Rejected outright.** It works for VS Code because the worst case is a bad editing experience. For
a system holding your finances, your home controls, and your correspondence, "the plugin can do
anything you can do" is not a defensible position, and it would render most of this Bible moot.

### WASM-only plugins

**Advantages:** the strongest available sandbox — genuine memory safety, capability-based by
construction, language-agnostic, and a real security boundary rather than an isolation convenience.

**Seriously considered and deferred rather than rejected.** The reason is developer experience: the
tooling for writing rich plugins in WASM with useful host functions is still awkward enough that it
would meaningfully suppress the ecosystem we are building the system for.

**This is the most likely future evolution.** The plugin host is designed with an isolation
abstraction so that WASM can be added as a fourth isolation mode without redesigning the permission
model. If WASM tooling matures — which seems likely — community plugins should move to it.

### Container-based isolation (Docker per plugin)

**Advantages:** strong, well-understood isolation with mature tooling.

**Rejected** because it requires Docker on the user's machine — a large dependency for a personal
assistant — with significant memory overhead per plugin and slow startup. Disproportionate for a
laptop.

### Plugins as external HTTP services

**Advantages:** perfect isolation (a different machine entirely), any language, no sandbox needed.

**Rejected as the primary model** because it inverts the privacy story: FRIDAY would send your data
*out* to a plugin's server. Article IV. **Retained as a supported plugin type** for cases where it
genuinely makes sense, with the same egress declaration and data-category rules as connectors, and
a prominent warning at install.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Process isolation costs ~30 MB and ~40ms startup per plugin.** | Accepted for untrusted code. First-party departments stay in-process. |
| **The restricted permission set means some legitimate plugins are impossible.** | Accepted deliberately. Some capabilities should not be available to code the user cannot audit. |
| **Signature verification requires key management** and a distribution story. | Accepted — deferred along with the feature. |
| **The trial period adds install friction.** | Accepted — it converts an uninformed decision into an informed one. |
| **Designing this now costs effort for a feature years away.** | Accepted — the alternative is retrofitting a trust boundary into a system built without one, which does not work. |
| **A plugin ecosystem may never materialize** for a personal system with one user. | Accepted — the design cost is modest, and the manifest/permission machinery is used by first-party components regardless. |

---

## Review triggers

- FRIDAY reaches M8 with a stable department API → begin implementation
- WASM component tooling matures → adopt as the community isolation mode
- You find yourself writing many small extensions → the verified tier may be worth building earlier
- Any first-party component needs a permission the plugin model forbids → the model may be too
  restrictive

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
