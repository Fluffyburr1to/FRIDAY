# ADR-0051 — The least precise location that answers the question

- **Status:** accepted
- **Date:** 2026-08-24
- **Accepted:** 2026-08-24
- **Deciders:** Tyler Hutson
- **Supersedes:** none
- **Related:** [ADR-0048](0048-the-first-connector-is-weather.md) · [ADR-0047](0047-egress-hosts-are-exact-and-a-pattern-is-a-separate-decision.md) · [Chapter 14](../01-bible/14-connector-framework.md) · Constitution Article IV

---

## Context

[ADR-0048](0048-the-first-connector-is-weather.md) chose weather as the first real connector, and
left two things undecided: which provider, and **how precisely the owner's location is disclosed.**
The provider is settled — Open-Meteo, which requires no account, no API key, and no signup, so the
first connector ships with **no credential in existence at all.**

That leaves location, and it is the entire privacy question for a weather connector. Weather has no
other input. *"What is it like outside?"* is answered by saying where you are, and there is nothing
else in the request to worry about.

Article IV states it directly: *"External services should only receive the minimum information
required."* This ADR decides what the minimum actually is, in numbers, rather than leaving it to
whoever writes the connector.

### The fact that makes this easy

Open-Meteo's models run at **1 to 11 km resolution**. Coordinates finer than about a kilometre
therefore carry **no information the forecast can use** — the model looks up the same grid cell
either way.

★ **So below roughly a kilometre, precision is not a trade-off. It is pure disclosure with nothing
bought.** That is unusual and worth stating plainly, because most privacy decisions cost something
and this one, up to a point, does not.

For coordinates in decimal degrees:

| Decimals | Roughly | What it identifies |
|---|---|---|
| 1 | 11 km | a city and its surroundings |
| **2** | **1.1 km** | **a neighbourhood** |
| 3 | 110 m | a street |
| 4 | 11 m | a building |
| 5+ | ~1 m | where you are standing |

Two decimals is the point where more stops helping.

---

## Decision

We will **send the least precise representation that answers the request, and require a written
reason before sending anything more precise.**

### 1. Three representations, and a default

| Level | What is sent | When |
|---|---|---|
| `named-place` | a place name the owner configured | when the owner asked about a named place |
| **`coarse`** | **latitude and longitude rounded to 2 decimals (~1.1 km)** | **the default for everything** |
| `precise` | coordinates as supplied | only with a stated reason (§2) |

**`coarse` is what a connector sends unless something says otherwise.** There is no code path where a
connector silently forwards whatever coordinates it was handed.

### 2. Precision requires a reason, and the reason is a value in the request

★ `precise` is not a flag. A request for it **carries a non-empty justification string**, validated
in the schema, so a precise request without a stated reason **cannot be constructed** — the same
mechanism as `scopeJustification` in the connector manifest, and for the same purpose.

The reason is recorded in the event, so *what left, when, and why* is answerable from the trail
rather than from someone's memory of what the code does.

Two things qualify, and the connector decides neither:

- **The owner asked for it** — a question about a specific spot rather than about where they are.
- **The question genuinely needs it** — the answer would be wrong at neighbourhood scale.

For weather, the second is close to empty. It is written into the rule anyway because the rule
outlives this connector.

### 3. Rounding is toward the grid, not toward the owner

Rounding is arithmetic on the coordinate, with no offset, no jitter, and no snapping to a populated
place. Deliberately boring: a clever scheme that moved the point *away* from the owner would be
inventing a location, and a forecast for somewhere the owner is not is a wrong answer delivered
confidently.

### 4. Coarse and precise are different data categories

`coarse_location` and `precise_location` are declared separately in the manifest, so the privacy
dashboard's answer to *"what left my machine this week?"* distinguishes *"roughly where I live,
daily"* from *"exactly where I was on Tuesday."* Collapsing them into `location` would make the
honest answer unavailable.

### 5. What never leaves, at any level

- A street address, a postcode, or a place name the owner did not choose.
- Any identifier alongside the location — no device id, no account, no correlation id in the URL.
- A location for anyone other than the owner.
- A history. One request carries one point, never a track.

---

## Constitutional review

- **Article IV (Privacy — minimum necessary disclosure):** the whole ADR. §1 sets the minimum in
  numbers; §2 makes exceeding it require saying why.
- **Article II (Transparency):** §2 and §4. The reason and the category are recorded, so the
  disclosure is auditable rather than asserted.
- **Principle 4 (Privacy Is Fundamental):** *"External services should only receive the minimum
  information required."* Two decimals is that minimum for a 1 km model.

**The five questions:**

- [x] **Can the user see it?** Every request records its level, and `precise` records its reason.
- [x] **Can the user stop it?** `coarse` is the default and `precise` cannot happen silently.
- [x] **Can we replace it?** The rounding is one function; the levels are data.
- [x] **Can we explain it?** *"She told them roughly where you are — about a kilometre — because
      that is as much as the forecast can use."*
- [x] **Will this still be right in five years?** The reasoning will. The specific number follows
      the provider's model resolution and should be revisited if that changes.

**Notes:** §3 rejects a privacy technique that looks stronger than rounding. Stated as a decision
because "add jitter" is the obvious next suggestion and it is wrong here.

---

## Alternatives considered

### A. Send whatever coordinates the caller supplies

**What it is.** The connector is a translator; precision is the department's problem.

**Advantages.** Simplest. Keeps the connector free of judgment, which Chapter 14 otherwise asks for.

**Why rejected.** It makes the most sensitive property of the request a silent default set somewhere
else. The connector is the last place the data is FRIDAY's, and *"the connector had no judgment"*
would be small comfort in the audit trail. **This is the one place a connector holds a rule**, and
it holds it because it is the boundary, not because it is deciding anything.

### B. Named places only, never coordinates

**What it is. ** The owner configures a place; nothing finer is ever sent.

**Advantages.** The strongest possible position. No coordinate ever leaves.

**Why rejected.** It answers a worse question. A named place resolves to a city centre, and a
forecast for a city centre is wrong for someone twenty kilometres away in terrain that differs —
which for weather is common rather than exotic. It also does not remove disclosure; it discloses a
city, and for small places a city *is* a neighbourhood. Retained as a level rather than as the rule.

### C. Coordinates with random jitter

**What it is.** Displace the point by a random offset before sending.

**Advantages.** Sounds stronger than rounding, and defeats naive de-duplication across requests.

**Why rejected.** It invents a location. The forecast comes back for somewhere the owner is not, and
nothing downstream knows it is wrong. Rounding lands in the model's own grid cell — the same cell
the true point is in — so the answer stays correct. **Jitter trades an honest answer for a feeling
of privacy**, and repeated jittered requests average out to the true point anyway.

### D. One decimal (~11 km) as the default

**What it is. ** Coarser still.

**Advantages.** More conservative.

**Why rejected.** It is coarser than the model, so it degrades the answer for real privacy that is
not real — an 11 km cell still identifies a town. It costs accuracy to buy nothing, which is the
mirror image of the mistake this ADR is preventing.

---

## Consequences

**Positive**

- The default discloses a neighbourhood, and the forecast is exactly as good as it would have been.
- Precision cannot be reached by accident: it needs a sentence, and the sentence is recorded.
- The privacy dashboard can distinguish routine coarse disclosure from the rare precise one.

**Negative**

- **Rounding does not make a request anonymous, and it would be dishonest to imply it does.** The
  provider sees the connection's IP address on every call, which locates the owner at least as well
  as two decimals. What this controls is what FRIDAY *states*, not what the other end can *infer*.
  Anything more would need a relay, which is a much larger decision.
- **A coarse location requested daily is still a home location.** One request discloses a
  neighbourhood; a year of them discloses where the owner sleeps. Rounding limits the resolution,
  not the pattern.
- Every future connector taking a location must now choose a level and justify precision, which is
  friction. That is the intent.

**Neutral**

- The rounding is arithmetic. No dependency, no lookup, no table.

---

## Reversibility

- **Cost to reverse:** low. The levels are data and the rounding is one function.
- **How:** change the default, or add a level.
- **Point of no return:** none for the code. There is one for the disclosure: **a precise
  coordinate that has been sent cannot be unsent**, which is the asymmetry the default exists for.

---

## Review triggers

- **A provider's model resolution goes below ~1 km** — the two-decimal default should follow it.
- **Any connector requests `precise` routinely** — either the rule is wrong or the caller is, and
  the recorded reasons will say which.
- **A location connector is proposed that is not weather** (transit, mapping) — the levels are
  reusable, the default may not be.
- **The IP-address gap becomes worth closing** — that is a relay decision, not this one.

---

## Notes

**What this does not do.** It does not anonymise anything. See the first negative consequence: the
provider learns roughly where the owner is from the connection itself, and this ADR governs what
FRIDAY says rather than what can be worked out. Treating rounding as anonymity would be the
comfortable mistake.

**Why the connector holds this rule at all**, when Chapter 14 says connectors have no judgment: it
is not judgment. It is a bound. The connector does not decide *whether* to answer or *what* the
answer means — it decides nothing. It refuses to state more than it was given a reason to state,
which is the same shape as refusing a host that is not on its list.
