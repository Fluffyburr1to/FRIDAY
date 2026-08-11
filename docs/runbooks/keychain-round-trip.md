# Runbook — Prove the real Keychain round trip

**When to use this:** before any work depends on `friday init` actually provisioning keys — the M4
opening gate; after changing anything in `packages/storage/src/crypto/`; or when a Keychain failure
is suspected and you need a known-good comparison on a machine you are allowed to break.

**Why it matters:** every automated test injects an in-memory provisioner. The production path —
`createKeychainKeyProvisioner` invoking `/usr/bin/security` — is the one part that no green test
covers, and green tests are exactly what would keep being green if it were wrong. This procedure is
how that path gets exercised on purpose instead of on a user's machine by accident.

Reference: [ADR-0035](../adr/0035-first-run-provisioning-is-creation-only.md) ·
[ADR-0020](../adr/0020-key-material-comes-from-an-injected-key-provider.md) ·
[Chapter 18](../01-bible/18-security-model.md) · [Chapter 39](../01-bible/39-roadmap.md)

---

## ⚠ Read this before running anything

**Your login keychain must be unreachable before a single byte is written.** ADR-0035 records that
the `security` command's argument handling *"had already caused stray writes to a real login
keychain once"*. This procedure is built so that the same mistake cannot land anywhere that matters.

**You will never be asked for your Mac login password, and this procedure never needs it.** The only
password involved is a throwaway one you invent for a disposable keychain that is deleted at the
end. **Never use your login password as the throwaway.** If any step ever prompts you for your real
password, stop — something is reaching the login keychain and the isolation has failed.

### The isolation has two halves, and both are required

| | What it does | Why it alone is not enough |
|---|---|---|
| **1. Redirect `HOME`** | Drops the login keychain out of the search list entirely. Verify: `security list-keychains` then returns only `System.keychain`. | It leaves **no default keychain at all**, so a write has nowhere to go — `security` tries to prompt and fails with *"The authorization was canceled by the user"*. |
| **2. Create a throwaway keychain inside that `HOME` and make it the default** | Gives the write a target. `add-generic-password` writes to the *default* keychain when no keychain is named. | On its own it would not remove the login keychain from the search list. |

**This is the correction to ADR-0035 §3.** That ADR did half 1, hit the prompt failure, and concluded
a real Keychain write "may not be exercisable in a non-interactive environment or in CI at all". With
half 2 it is exercisable, non-interactively.

**The second half also dodges a sharp edge.** ADR-0035 §3 explains that keeping key material out of
`argv` requires `-w` **last** with the value on stdin, while targeting a specific keychain requires a
**trailing positional path** — the same position, and a `-w` followed by a path silently eats the
path as the password. Because we set the *default* keychain instead of naming one, the command line
never carries a keychain path, and the conflict cannot arise.

---

## Prerequisites

- macOS, and a built workspace (`pnpm build`)
- `pnpm` on `PATH` — if it is not, `corepack pnpm` works, but Turbo needs a real `pnpm` binary on
  `PATH` or it fails with *"Unable to find package manager binary"*
- A scratch directory outside the repository. **Nothing here writes to the repository.**

---

## Procedure

Set up, with an abort guard that refuses to continue if the login keychain is still reachable:

```sh
FAKEHOME=/tmp/friday-kc/home
KC="$FAKEHOME/Library/Keychains/friday-roundtrip.keychain-db"
DATA=/tmp/friday-kc/data
PW=roundtrip-throwaway   # NOT your login password

rm -rf "$FAKEHOME" "$DATA"
mkdir -p "$FAKEHOME/Library/Keychains" "$FAKEHOME/Library/Preferences" "$DATA"

env HOME="$FAKEHOME" security create-keychain -p "$PW" "$KC"
env HOME="$FAKEHOME" security list-keychains -s "$KC"
env HOME="$FAKEHOME" security default-keychain -s "$KC"
env HOME="$FAKEHOME" security unlock-keychain -p "$PW" "$KC"
env HOME="$FAKEHOME" security set-keychain-settings "$KC"   # no auto-lock

env HOME="$FAKEHOME" security list-keychains | grep -q login && {
  echo "ABORT: login keychain is reachable"; exit 1; }
```

Run the production path. A distinct service name means that even a total isolation failure leaves
something identifiable rather than something that collides with FRIDAY's real credentials:

```sh
env HOME="$FAKEHOME" FRIDAY_DATA_DIR="$DATA" FRIDAY_KEYCHAIN_SERVICE=com.friday.roundtrip \
  node apps/cli/dist/index.js init
```

Expected: three rules seeded, **two keys created**, and the irreplaceability warning printed. Run it
a second time — expected: rules left alone, both keys already present, nothing changed.

Then start her, and read back what she wrote:

```sh
env HOME="$FAKEHOME" FRIDAY_DATA_DIR="$DATA" FRIDAY_KEYCHAIN_SERVICE=com.friday.roundtrip \
    FRIDAY_PORT=8917 node apps/core/dist/index.js &

env HOME="$FAKEHOME" FRIDAY_DATA_DIR="$DATA" FRIDAY_KEYCHAIN_SERVICE=com.friday.roundtrip \
  node apps/cli/dist/index.js verify
env HOME="$FAKEHOME" FRIDAY_DATA_DIR="$DATA" FRIDAY_KEYCHAIN_SERVICE=com.friday.roundtrip \
  node apps/cli/dist/index.js events tail --once -n 5
```

---

## Verification

| Check | Expected |
|---|---|
| Key length | `security find-generic-password -w …` returns 44 base64 characters — **32 bytes**, which is what `decodeKey` accepts and nothing else. |
| Payload is really encrypted | `sqlite3 "$DATA/events.db" "select substr(cast(payload as text),1,8) from events limit 1;"` → `enc:v1:`. If it is readable JSON, the field key was **not** exercised and the run proves nothing. |
| Chain | `friday verify` → *"The record is intact."* |
| Decryption | `friday events tail --once` prints the `guardian.decided` row. This is the proof the field key round-tripped. |
| Persistence | `security lock-keychain "$KC"`, read → fails **exit 128** non-interactively; unlock, read → succeeds. |
| **The ★ refusal** | Delete *only* the field key, leave the databases, re-run `init`. It must **refuse**, exit non-zero, and mint nothing. |

**The refusal check is the most important one here.** It is the behaviour ADR-0035 exists for, and
the only one whose failure mode is silent data loss rather than a crash.

---

## Teardown — do not skip

```sh
pkill -f apps/core/dist/index.js
env HOME="$FAKEHOME" security delete-keychain "$KC"
rm -rf "$FAKEHOME" "$DATA"
```

Then audit the machine you actually care about:

```sh
security default-keychain          # unchanged: login.keychain-db
security list-keychains            # unchanged
security find-generic-password -s com.friday.roundtrip   # must NOT be found
security find-generic-password -s com.friday.credentials # must NOT be found unless you really use FRIDAY here
```

---

## Result, 2026-08-10

Run in full. Every check above passed, including the refusal. `apps/core` started on the provisioned
state, composed a Guardian from the seeded rules, and passed its startup self-check. The login
keychain was audited before and after and was untouched — default unchanged, no `com.friday.*` item
present at any point.

The same procedure was then run against the **packaged** CLI — a bundle tarred and extracted at a
different path — and it behaved identically, resolving the shipped rules from inside the bundle.

---

## Known limits, stated rather than discovered later

- **CI portability is untested.** This has been demonstrated on a developer Mac. Nothing here
  establishes that it works on a hosted runner, and it should not be turned into a required CI check
  on the strength of this document alone. Whether it becomes an enduring automated test is an open
  decision — see [Chapter 39](../01-bible/39-roadmap.md), M4.
- **A locked keychain fails reads non-interactively** (exit 128). Harmless in this procedure, and a
  real design question for a LaunchAgent starting at login. Carried as an M4 risk.
- **One unreproduced anomaly.** A single spurious *"the passphrase you entered is not correct"* on
  unlocking the throwaway keychain, which did not recur across a clean cycle afterwards. Recorded for
  honesty; if it recurs during the launchd work it is no longer an anomaly.
- **This proves the write and read succeed. It does not prove they are the only two things that
  happen** — `security` is a subprocess, and this procedure observes its effects rather than its
  internals.
