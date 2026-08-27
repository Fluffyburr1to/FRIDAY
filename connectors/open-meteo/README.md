# open-meteo — Weather

**What leaves your machine:** roughly where you are — a point rounded to about a kilometre — and
nothing else. No name, no account, no identifier, no history.

Open-Meteo requires **no account, no API key, and no signup**, so FRIDAY holds no credential for
this connector and there is nothing to revoke, leak, or renew. That is why it is first
([ADR-0048](../../docs/adr/0048-the-first-connector-is-weather.md)).

## Exactly what is sent

One HTTPS request to **`api.open-meteo.com`**, carrying:

| Sent | Why |
|---|---|
| `latitude`, `longitude` | rounded to 2 decimals (~1.1 km) by default |
| the fields being asked for | e.g. temperature, wind |
| `timezone=UTC` | so a reply is not localised by inference from the coordinates |

**Nothing else.** No device id, no account, no correlation id, no place name, no history. One
request carries one point.

★ **Precision above the default requires a written reason**, carried in the request and recorded in
the audit trail ([ADR-0051](../../docs/adr/0051-the-least-precise-location-that-answers-the-question.md)).
The forecast models run at 1–11 km, so a finer coordinate names the same grid cell and improves the
answer by nothing.

`describeDisclosure` returns exactly what would be sent, without sending it.

## What it does not do

- **No named places.** Resolving a name to coordinates needs Open-Meteo's geocoding host, which is
  additional egress for a facility nothing yet asks for. Refused explicitly rather than silently.
- **No writes.** Every operation is read-only and idempotent, so there is nothing to preview and
  nothing that could be repeated harmfully.
- **No credentials.** There is no code path here that reads, holds, or asks for one.

## What is verified, and what is not

| Claim | Status |
|---|---|
| The host, the parameters, and the precision that leave | **Verified in code**, asserted by tests, and generated from the same value that is sent |
| Every operation is read-only and idempotent | **Verified** — declared in the manifest and enforced by the schema |
| No credential exists | **Verified** — there is no code path here that reads or holds one |
| `dataRetentionByProvider` | **UNVERIFIED.** FRIDAY's reading of public documentation. No terms have been read or agreed |
| The rate limits in the manifest | **FRIDAY's own ceiling**, not a published allowance. The provider's real limits are unverified |
| The response shapes the tests use | **UNVERIFIED.** Taken from published documentation; no real response has ever been observed |

★ The manifest describes what we currently believe. Two of its fields would
otherwise read as commitments a provider had made, and neither is.

## Honest limits

Rounding is not anonymity. Open-Meteo sees the connection's IP address, which places you at least as
well as two decimals do. What the rounding controls is what FRIDAY **states**, not what the other
end can **infer** — and a coarse location asked for daily still describes where you sleep.

Reference: [Chapter 14](../../docs/01-bible/14-connector-framework.md)
