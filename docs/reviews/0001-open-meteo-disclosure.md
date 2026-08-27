# Review 0001 — Open-Meteo: what leaves, and what does not

- **Connector:** `connectors/open-meteo` (`@friday/connector-open-meteo`)
- **Reviewed:** 2026-08-24
- **Reviewer:** Claude (AI contributor), for owner decision
- **Status:** complete at code and documentation level. **No real call has been made.**
- **Related:** [ADR-0048](../adr/0048-the-first-connector-is-weather.md) · [ADR-0051](../adr/0051-the-least-precise-location-that-answers-the-question.md) · [ADR-0047](../adr/0047-egress-hosts-are-exact-and-a-pattern-is-a-separate-decision.md) · [Chapter 14](../01-bible/14-connector-framework.md)

---

## 1. What leaves FRIDAY

**One HTTPS request, to one host, per question asked.**

```
GET https://api.open-meteo.com/v1/forecast
      ?latitude=55.95
      &longitude=-3.19
      &current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m
      &timezone=UTC
```

| Field | Value | Why it is there |
|---|---|---|
| `latitude`, `longitude` | rounded to 2 decimals (~1.1 km) | the question cannot be answered without a place |
| `current` / `daily` | a fixed list of field names | asking for less would need a second request |
| `timezone` | always `UTC` | so the provider does not infer a timezone, and therefore a region, from the coordinates |

**Nothing else is sent.** No header is added beyond what the runtime sets. There is no body — every
operation is a GET.

## 2. To whom, and under what conditions

- **To exactly one host:** `api.open-meteo.com`, the only entry in the manifest's allowlist, enforced
  before the request is made ([ADR-0047](../adr/0047-egress-hosts-are-exact-and-a-pattern-is-a-separate-decision.md)).
  A request to any other host is refused before DNS.
- **Only over TLS.** Plain HTTP is refused even to the declared host.
- **Only on a declared operation.** `current-weather` and `daily-forecast`; anything else is refused
  before a URL exists.
- **Only when something asks.** There is no scheduler, no background poll, and no retry of a request
  the caller abandoned.

## 3. What does not leave

Asserted by test, not by inspection:

- **No identifier of any kind.** No account, device id, session, correlation id, or user agent
  beyond the runtime's. A test sweeps the generated URL for `key`, `token`, `apikey`, `user`, `id=`,
  `session`, and `correlation`.
- **No name.** Not the owner's, and not a place name — see §5.
- **No history.** One request carries one point. There is no batching and no series.
- **No credential.** None exists. `auth.type` is `none` and there is no code path in the connector
  that reads, holds, or asks for one.
- **No unrounded coordinate by default.** A test asserts the URL for a real coordinate contains
  neither `55.953` nor `3.1882`.

## 4. Precision, and when more than the default is sent

Default is **`coarse`** — 2 decimals, about 1.1 km, a neighbourhood.

The forecast models run at **1–11 km**, so a finer coordinate names the same grid cell and improves
the answer by nothing. Below roughly a kilometre this is disclosure with nothing bought.

**Exact coordinates are sent only with a written reason**, carried in the request as a required
value. A precise location without one **cannot be constructed** — the schema refuses it — and the
reason travels into the audit record. Coarse and precise are separate data categories, so the
privacy dashboard can distinguish routine disclosure from exceptional.

## 5. Place names are refused, not resolved

A `named-place` request is refused with `NOT_IMPLEMENTED` rather than geocoded.

Resolving a name would mean a **second host** and a **different kind of disclosure** — a name is not
a coordinate, and *"Sarah's house"* or a workplace name discloses far more than a point does. Adding
it is a manifest change with a visible audit record, which is the friction ADR-0047 accepted.

## 6. Health checks — examined specifically

**The probe never carries the owner's location.** It asks about latitude 0, longitude 0.

Three properties make that structural rather than careful:

1. `health()` **takes no arguments**, so there is nothing for a caller to pass in.
2. The probe location is a **module-scope constant**, not derived from anything.
3. `ask()` receives its location as an **explicit argument** on every call. There is no shared,
   cached, or ambient context holding a "last location" that a probe could pick up.

★ **Tested against the refactor rather than today's code**: one test asks about a real place, *then*
runs a health check, and asserts the probe still went to 0,0. That is what would catch a future
"shared request context" quietly leaking the caller's position into monitoring.

A check at the manifest's 15-minute interval carrying a real location would be a **daily location
feed dressed as monitoring**, and it would look like monitoring in every review.

## 7. What is verified, and what is not

★ The distinction this review exists to keep.

| Claim | Status |
|---|---|
| The host, parameters, and precision that leave | **Verified in code.** The URL is generated from the same value `describeDisclosure` returns, so there is no second path that could send something the description omits |
| Every operation is read-only and idempotent | **Verified** — declared and schema-enforced |
| No credential exists | **Verified** — no code path holds one |
| Undeclared hosts and plain HTTP are refused | **Verified** — SDK boundary, mutation-tested |
| Health probe never carries the owner's location | **Verified** — including against inheritance |
| `dataRetentionByProvider` | **UNVERIFIED.** A paraphrase of public documentation. No terms have been read or agreed. The field now says so in its own value |
| Manifest rate limits | **FRIDAY's own ceiling**, not a published allowance. The provider's real limits are unverified and nothing would notice if they were lower |
| Response shapes used by the tests | **UNVERIFIED.** Taken from published documentation. **No real response has ever been observed** |

## 8. Findings

**No blocking findings at code level.** Three worth recording:

1. **The response shapes are unverified**, and that is the one gap fixtures cannot close by
   construction. See §9.
2. **Rounding is not anonymity.** Open-Meteo sees the connection's IP on every request, which places
   the owner at least as well as two decimals do. This review covers what FRIDAY *states*; it does
   not and cannot cover what the other end can *infer*. Closing that means a relay, which is a much
   larger decision and is recorded as a review trigger on ADR-0051 rather than opened here.
3. **A coarse location asked for daily is still a home location.** Rounding limits resolution, not
   pattern. Nothing here rate-limits *disclosure over time* as opposed to requests per minute.

## 9. The proposed real call — for owner decision

**Recommendation: yes, one call, and only with your explicit approval.**

### What it would disclose

Exactly what §1 describes, once: **one HTTPS GET to `api.open-meteo.com`** carrying a coordinate
rounded to ~1.1 km, a fixed field list, and `timezone=UTC`.

★ **I propose using the health-probe point — latitude 0, longitude 0 — not a real location.** Then
the call discloses *nothing about the owner at all*: it reveals only that some client at this IP
asked about the weather at Null Island. The IP is disclosed by the act of connecting and cannot be
avoided without a relay.

No account, no signup, no credential, no header identifying FRIDAY beyond the runtime default.

### Why fixtures cannot establish it

The fixtures are **my reading of Open-Meteo's published documentation**, written by the same author
as the code they exercise. They therefore prove the connector is self-consistent, and cannot prove:

- that the response **shape** matches what the parser expects — a renamed or nested field would pass
  every test here and fail in the owner's hands;
- that the parameters are **accepted**, rather than ignored or rejected — a wrong parameter name
  returns a valid-looking response for the wrong query;
- that `timezone=UTC` is **honoured**, rather than silently overridden;
- that the host **serves TLS** as expected and does not redirect — a redirect would be refused by the
  guard, which is correct, but I would rather learn that now than in front of you.

**A fixture written from documentation tests the documentation, not the service.**

### What new evidence one call provides

- A real response body, which can then become a **recorded fixture** — Chapter 14's actual
  requirement, and stronger than one written by hand.
- Confirmation that the request is well-formed rather than merely plausible.
- Observation of the real headers, status, and any redirect.

### Cost of being wrong

Low, and bounded: one request, to a service requiring no account, disclosing a point in the ocean.
If the response shape differs, the fix is in the parser and the fixture — nothing is irreversible
and nothing about the owner has been disclosed.

### What I will NOT do without further approval

- Use a real location.
- Make more than one call.
- Create an account, obtain a key, or accept any terms.
- Contact the geocoding host, or any host not in the manifest.

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-24 | Initial review, before any real call. Records the outbound disclosure in full, separates verified from unverified, examines the health-check path specifically for context inheritance, and proposes one controlled call at a location disclosing nothing about the owner. |
