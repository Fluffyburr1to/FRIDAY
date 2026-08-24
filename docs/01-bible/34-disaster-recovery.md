# 34 — Disaster Recovery Strategy

> **Governing provisions:** Constitution **Article I** (the user's data belongs to the user),
> Article IV (Privacy), **Article VII (Reliability)**; Manifesto Principle 9 (Fail Gracefully);
> Core Value 8 (Fail Safely).

---

## In plain language

This chapter answers: **what happens when something goes badly wrong, and how do you get FRIDAY
back?**

The scenarios worth planning for, in descending order of likelihood:

1. A bad update or migration corrupts something
2. Your Mac's disk fails
3. Your Mac is lost or stolen
4. A credential is compromised
5. Data is accidentally deleted
6. FRIDAY behaves in a way you do not trust

There is one principle that shapes everything below, and it is worth stating clearly because it is
easy to get wrong:

> **A backup you have never restored is not a backup. It is a hypothesis.**

Untested backups fail at the worst possible moment, and they fail in ways that are individually
predictable and collectively surprising — the archive is corrupt, the encryption key was never
saved, the restore script assumed a directory that no longer exists, the process takes eleven hours
instead of ten minutes. Every one of those is discovered during the disaster, which is the one time
you cannot afford to discover it.

So FRIDAY **tests her own restore automatically, every night**, and reports if it fails. That single
practice is worth more than any amount of backup configuration.

---

## Recovery objectives

Stated as numbers, because "we back things up" is not a plan.

| Data | RPO (max data loss) | RTO (max downtime) | Justification |
|---|---|---|---|
| **Event log / audit trail** | **0** | 1 hour | It is the Constitution's record. Losing it is unrecoverable in principle, not just in practice. |
| Main database | 5 minutes | 1 hour | Losing five minutes of plans and memories is an inconvenience |
| Credentials | 0 | 15 minutes | In the Keychain, backed by your existing Mac backup |
| Configuration | 0 | 5 minutes | In git |
| Cache | ∞ — not backed up | 0 | Regenerable by definition |

**RPO 0 for the audit trail** is the demanding requirement and it drives the choice of backup
technology below. Everything else follows from it.

---

## Backup architecture

Three tiers. Each protects against a different failure.

```
TIER 1 — CONTINUOUS               protects against: corruption, bad update
  Litestream → Backblaze B2
  Streams the SQLite write-ahead log continuously.
  RPO: seconds.  Cost: ~$1–3/month.
  ★ Encrypted with a key you hold, before it leaves the machine.

TIER 2 — DAILY SNAPSHOT            protects against: logical corruption
  Full consistent snapshot, encrypted, to B2.
  Retention: 7 daily · 4 weekly · 12 monthly · 3 yearly

TIER 3 — LOCAL                     protects against: no internet, fast restore
  Daily snapshot to an external drive or a second folder.
  Also covered by your existing Time Machine backup.
```

**Litestream is the choice that makes RPO 0 achievable.** It continuously replicates SQLite's
write-ahead log, so a restore can reconstruct the database to within seconds of the failure. The
alternative — periodic full copies — means losing everything since the last copy, which for an
hourly schedule is up to an hour of the audit trail.

**Encryption before egress is non-negotiable.** Backblaze stores an encrypted blob it cannot read.
The key lives in your Keychain **and** on the paper recovery card described below. Article IV means
the backup provider learns nothing.

### Where FRIDAY's secrets live

**Two Keychain services, and the split is a safety property rather than tidiness.**

| Service | Holds | Created by | Deleted by |
|---|---|---|---|
| `com.friday.credentials` | `field-encryption-key`, `backup-encryption-key`, model provider API keys | `friday init`, once | **Nothing in FRIDAY.** Create-only ([ADR-0035](../adr/0035-first-run-provisioning-is-creation-only.md)) |
| `com.friday.connector-credentials` | one item per connector, plus a marker per revoked connector | connecting a service | revoking that connector |

★ **The reason they are separate is that one of them is deletable and the other must never be.**
Revoking a connector deletes its credential. If revocation and the encryption keys shared a service,
the operation that withdraws a calendar's access would be one wrong string away from destroying
`field-encryption-key` — which takes every encrypted field in the database with it, permanently.
[ADR-0050](../adr/0050-revocation-is-a-credential-domain-operation.md) makes that structural: the
credential store is bound to its own service at construction and cannot name the other one at all.

**Only the first service is on the recovery card.** Connector credentials are deliberately not
backed up and not printed — see *Credentials are deliberately not restored* below. Losing them costs
you a re-authorization; losing the two keys on the card costs you everything.

**A revoked connector leaves a marker behind**, in the same service, recording that you disconnected
it. That is what stops a later write silently reconnecting something you refused. If a connector is
removed from FRIDAY entirely, its marker stays — harmless, and **not cleaned up automatically by
design**, because a sweeper that removes revocation markers is a sweeper that can un-revoke things.
Deferred until there is a concrete reason to need it.

### The recovery card

This is the piece people skip and then regret.

A single printed card, stored physically somewhere safe (a home safe, a safe deposit box),
containing:

- The backup encryption key — `backup-encryption-key`
- **The field-encryption key** — `field-encryption-key`
- Both keys are accounts in the **`com.friday.credentials`** Keychain service, stored base64-encoded
  and decoding to exactly 32 bytes ([Chapter 18](18-security-model.md)) — see *Where FRIDAY's
  secrets live* below, because that is no longer the only service she uses
- The B2 bucket name and read credentials
- The passkey recovery codes ([Chapter 17](17-authentication-authorization.md))
- A short, plain-language restore procedure
- The URL of the full runbook

**If your Mac is destroyed and you have no card, encrypted backups are indistinguishable from
random noise.** The card is generated during setup, and setup is not considered complete until you
confirm you have printed and stored it. FRIDAY reminds you annually to verify it still exists and is
current.

**★ Two keys, and they fail differently.** The backup encryption key turns the blob in Backblaze
back into a database file. The field-encryption key turns that database's private payloads back into
text. A recovery carrying only the first yields a database that opens, passes `PRAGMA
integrity_check`, and verifies its hash chain end to end — and whose sensitive fields are `enc:v1:…`
strings that nothing on the machine can read. **That is the worst shape a restore can take, because
every check reports success.** Losing the backup key costs you the archive; losing the field key
costs you the contents of an archive you still have.

---

## Nightly restore verification

The most important operational practice in this chapter.

```
Every night at 03:00
  1  Restore the latest backup into a temporary location
  2  Verify SQLite integrity           PRAGMA integrity_check
  3  ★ Verify the audit hash chain end to end
  4  Verify expected row counts are within tolerance
  5  Verify the newest event is < 24h old
  6  Record the result; destroy the temporary copy
  7  ANY FAILURE → notify at `urgent` urgency
```

Step 3 is unique to FRIDAY and is the one that matters most. Verifying that the restored audit chain
hashes correctly from the first event to the last proves that the audit trail is not only present
but **intact and unmodified**. That is the property the entire Constitution depends on, and it is
verified nightly rather than assumed.

A backup that restores but whose chain does not verify is a corrupted backup, and knowing that
tonight rather than during a disaster is the whole point.

---

## Recovery procedures

Full step-by-step runbooks live in `docs/runbooks/`. Summarized here so the shape is visible.

### Bad update or migration

```
friday rollback
```
Restores the previous version and offers the pre-update snapshot. **RTO: ~5 minutes.** This is the
most likely disaster and it has the simplest recovery, by design
([Chapter 33](33-deployment-strategy.md)).

### Disk failure or lost machine

```
1  New Mac; install FRIDAY
2  ★ Restore both keys from the card — before init, before restore
       security add-generic-password -s com.friday.credentials -a backup-encryption-key -w
       security add-generic-password -s com.friday.credentials -a field-encryption-key  -w
       -w goes last with no value: the key is typed at the prompt, twice, and never
       reaches the command line or your shell history
3  friday restore --from-backup      (needs the recovery card)
4  Re-authenticate connectors        (tokens are not restored — see below)
5  Verify: audit chain, memory count, and that a private payload reads back as text
6  Resume
```
**RTO: ~1 hour**, most of it download time.

**★ Step 2 is ordered before step 3 deliberately, and the order is the whole of it.** Key
provisioning is creation-only ([ADR-0035](../adr/0035-first-run-provisioning-is-creation-only.md)):
FRIDAY creates a key that is missing and **never replaces one that is present**. Run setup first on
a bare machine and it mints a *fresh* field-encryption key, entirely correctly — and the backup you
then restore is encrypted under the old one. You are left with a database FRIDAY cannot read and a
Keychain holding the wrong key.

**Nothing will overwrite it for you, and that is deliberate.** `add-generic-password` is invoked
without `-U`, so writing over an existing item fails with exit 45 and *"The specified item already
exists in the keychain"*, leaving the stored value untouched. Recovering from a wrongly-minted key
therefore means removing it with `security delete-generic-password -s com.friday.credentials -a
field-encryption-key` before adding the one from the card. Put the card's key in place first and
none of that arises: provisioning finds it already there and leaves it alone.

There is a guard, and it does not cover this case. ADR-0035's refusal fires when a database is
present and the field key is *missing* — it exits non-zero, explains why, and mints nothing. A fresh
machine has no database at that moment, so nothing refuses. **The ordering above is the control, not
the guard.**

**Verify the field key specifically at step 5.** `friday events tail` against the restored log is
the cheap check: a stored payload comes back as text rather than as `enc:v1:…`. Verifying the audit
chain proves the log is intact; it does not prove you can read it, and those are different claims.

**Credentials are deliberately not restored from backup.** Connector credentials live in
`com.friday.connector-credentials` and are re-authorized on the new machine. This is a small
inconvenience that eliminates a large risk: a stolen backup can never yield working credentials to
your accounts.

★ **A restored machine starts with no connector credentials and no revocation markers.** That means
a connector you deliberately disconnected on the old machine is `absent` rather than `revoked` on
the new one — so it can be reconnected without the explicit step that would otherwise be required.
Revocation is durable against a later *write*, not against a *rebuild*. If you revoked something
because it was compromised, revoke it at the provider too; that is the revocation that survives.

### Credential compromise

```
1  friday panic --revoke-all         ← immediate, no confirmation prompt
2  Rotate credentials at each provider
3  Review the audit trail for the exposure window
4  Re-authorize connectors individually
5  Write an incident note
```
**RTO: ~15 minutes to safe.** `friday panic` revokes every token, disables every connector, and puts
FRIDAY in Safe Mode. It runs without confirmation because a confirmation prompt during a compromise
is the wrong design.

### Accidental deletion

```
friday restore --point-in-time "2026-08-06T14:00:00Z"
```
Litestream's continuous replication makes point-in-time restore possible to within seconds. Restores
into a separate location first so you can verify before replacing anything.

### FRIDAY behaving in a way you do not trust

```
friday safe-mode
```
Immediate. Agents halted, connectors disabled, no autonomous action. The kernel and dashboard stay
up so you can read the audit trail and understand what happened.

**This is the most important recovery command in the system**, and it is why the deployment strategy
can insist that CI is never skipped for a hotfix ([Chapter 32](32-branch-strategy.md)). Safe Mode
stops the harm; the fix proceeds normally.

---

## Safe Mode

A first-class operating state, not an error condition.

| Entered | By |
|---|---|
| Automatically | Startup failure, corrupt database, failed migration, integrity failure, 5 crashes in 60s, disk full |
| Manually | `friday safe-mode`, or from the dashboard |

**Available in Safe Mode:** the dashboard, the full audit trail, diagnostics, configuration,
backup and restore, and a plain-language explanation of why she is in Safe Mode and what she
recommends.

**Not available:** agents, connectors, scheduled work, model calls, any autonomous action.

Safe Mode is what "fail gracefully" (Principle 9) means in practice. FRIDAY does not crash and leave
you with nothing. She reduces herself to a state that cannot cause harm, keeps the parts that let
you understand the problem, and tells you what she thinks is wrong.

---

## Data export — the ultimate recovery

Article I says your data belongs to you. The strongest expression of that is being able to leave.

```
friday export --all --output ~/friday-export
```

Produces: every table as JSON and Parquet, the complete event log, all memories with provenance, all
documents and attachments, all configuration, and a `README` explaining the format — with the schema
documented so the data is comprehensible without FRIDAY.

**Runs monthly, automatically, to your local disk.** Even if FRIDAY were abandoned entirely, or this
project ended, the data remains yours in open, documented formats readable by ordinary tools.

That property is worth more than any backup system, because it protects against the failure mode no
backup covers: the software itself becoming unavailable or untrustworthy.

---

## Annual disaster drill

Once a year, deliberately, on a calendar reminder FRIDAY creates:

1. Restore the latest backup to a scratch location
2. Verify the audit chain and spot-check memories
3. Time the full procedure and record it
4. Verify the recovery card is present, legible, and current — **including both keys**
5. Confirm B2 credentials still work
6. Update the runbook with anything that surprised you

**Step 6 is the point of the exercise.** Runbooks written once and never exercised drift from
reality — a command changes, a path moves, a step is missing. The drill is what keeps the runbook
true.

---

## Alternatives considered

### Time Machine only

**Advantages:** already running; zero configuration; free.

**Rejected as sufficient** because Time Machine backs up hourly at best, meaning up to an hour of
audit trail loss (RPO 0 is not met). It also has no integrity verification for SQLite specifically,
and restoring an in-use SQLite database from a file-level backup can produce corruption.

**Retained as Tier 3.** It is a genuinely useful additional layer.

### Cloud sync (iCloud, Dropbox) for the database

**Rejected firmly.** File-sync services and live SQLite databases interact badly — sync can copy a
database mid-write, producing corruption that then syncs everywhere. It also means unencrypted data
on a third party's servers. This is a common mistake and it destroys data.

### Backing up to a self-hosted server

**Advantages:** no third party at all; strongest privacy posture.

**Rejected as primary** because it requires maintaining another machine, and if it is in the same
building it does not protect against fire or theft. **A good addition** for someone who has one, and
supported by Litestream's SFTP target.

### No off-site backup (local only)

**Rejected** — does not protect against fire, flood, or theft, which are the scenarios where you
most need FRIDAY's memory intact.

### Longer RPO for the event log (hourly instead of continuous)

**Advantages:** much simpler; periodic file copies instead of streaming replication.

**Rejected** because the audit trail is the Constitution's record. An hour of missing audit history
is an hour where FRIDAY's actions are unaccountable, permanently. Litestream costs $1–3/month and a
one-time configuration.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Backup costs $1–3/month** and requires a B2 account. | Trivially accepted. |
| **The recovery card is a physical artifact** that can be lost or become stale. | Accepted — annual verification reminder. There is no digital alternative that survives losing all devices. |
| **Nightly restore verification consumes CPU and bandwidth.** | Accepted — runs at 03:00, and it is the highest-value practice in the chapter. |
| **Credentials are not restored**, requiring re-authorization after a restore. | Accepted deliberately — it means a stolen backup cannot yield account access. |
| **Rolling back across a migration loses minutes of data.** | Accepted and stated plainly ([Chapter 33](33-deployment-strategy.md)). |
| **The annual drill takes an hour of your time.** | Accepted — it is the only thing that keeps the runbooks true. |
| **Litestream is a single-purpose dependency** we rely on for RPO 0. | Accepted — mature, widely used, and Tier 2 snapshots provide a fallback if it fails. |

---

## Review triggers

- Any restore verification failure → immediate investigation
- An actual disaster occurs → update runbooks with what actually happened within 48 hours
- Backup size or cost grows unexpectedly → review retention
- RTO measured in a drill exceeds the target → improve the procedure
- The core moves to always-on hardware (M5) → the entire strategy is re-examined
- Litestream is abandoned by its maintainers → migrate to an alternative

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
| 1.2 | 2026-08-24 | **Both Keychain services documented**, ahead of the first real credential existing, so the recovery procedure describes reality rather than half of it. [ADR-0050](../adr/0050-revocation-is-a-credential-domain-operation.md) put connector credentials in a service of their own precisely so that revocation — which deletes — can never address the encryption keys, which are create-only. Records what is on the recovery card and what deliberately is not, that revocation markers are left behind on purpose and are not swept, and the consequence nobody had written down: **a rebuilt machine has no revocation markers**, so a connector revoked on the old machine reads as never-connected on the new one. Revocation is durable against a later write, not against a rebuild. |
| 1.1 | 2026-08-14 | The field-encryption key added to the recovery card and to the lost-machine procedure, with the ordering that makes a by-the-book recovery yield readable payloads. Closes the gap [ADR-0035](../adr/0035-first-run-provisioning-is-creation-only.md) surfaced and assigned here. |
