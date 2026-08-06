# 25 — Voice System Architecture

> **Governing provisions:** Constitution **Article IV (Privacy)**, Article III (Approval), Article
> IX (Respect); Manifesto Principle 4 (Privacy Is Fundamental), Principle 10 ("the best interface is
> often the one that disappears").

---

## In plain language

Voice is the interface that most makes FRIDAY feel like FRIDAY. It is also the one with the highest
privacy stakes in the entire system, and the design is dominated by that fact.

An always-listening microphone in your home is among the most intrusive things software can ask for.
Every major voice assistant has had an incident where recordings were retained, transmitted, or
reviewed by humans in ways users did not expect. Article IV — *"prefer local processing whenever
practical"* — is not ambiguous about what FRIDAY should do here.

So the rule is simple and absolute:

> **Audio never leaves your machine. Ever. Under any configuration.**

Wake word detection, speech recognition, and speech synthesis all run locally on your Mac. What may
leave — after you have spoken, after the audio has been converted to text on your machine, and
subject to the same rules as any other request — is *text*, and only when the Model Router's
sensitivity policy permits it.

The second design decision is about trust: **push-to-talk first, wake word later.** FRIDAY starts
with a keyboard shortcut. Always-listening is opt-in, added at Milestone 7, and comes with a
hardware-level guarantee you can verify — the macOS microphone indicator. Trust is earned
(Principle 3), and asking for an always-on microphone on day one is asking for trust that has not
been earned yet.

---

## Recommendation

A fully local pipeline of sealed processes, orchestrated by `packages/voice`.

```
  MICROPHONE
      │  (only while triggered — see activation below)
      ▼
┌──────────────────────────────────────────────────────┐
│ 1  WAKE / TRIGGER          openWakeWord (local)      │
│    Rolling 2-second buffer, never written to disk.   │
│    Discarded continuously unless triggered.          │
├──────────────────────────────────────────────────────┤
│ 2  CAPTURE                 until silence or timeout  │
│    Audio held in memory only.                        │
├──────────────────────────────────────────────────────┤
│ 3  SPEECH → TEXT           whisper.cpp (local)       │
│    Sealed child process. No network capability.      │
│    ★ AUDIO IS DESTROYED IMMEDIATELY AFTER            │
├──────────────────────────────────────────────────────┤
│ 4  INTENT                  → Chief of Staff          │
│    From here it is an ordinary request. Same         │
│    Guardian, same approvals, same audit trail.       │
├──────────────────────────────────────────────────────┤
│ 5  TEXT → SPEECH           Piper (local, default)    │
│                            ElevenLabs (opt-in,       │
│                            per-utterance, non-       │
│                            sensitive content only)   │
├──────────────────────────────────────────────────────┘
      ▼
  SPEAKER
```

**Step 3's destruction rule is the load-bearing one.** Raw audio is held in memory, transcribed, and
the buffer is zeroed. It is never written to disk, never cached, never included in a log, never
attached to an event. The event log records the *transcript* (classified `private`), never the
recording.

The only exception is an explicit, session-scoped debug mode that requires you to turn it on, shows
a persistent visual indicator the entire time it is active, and turns itself off after 15 minutes.

---

## Activation

| Mode | Trigger | Availability | Microphone state |
|---|---|---|---|
| **Push-to-talk** | Global hotkey (`⌥Space` held) | **M7, default** | Active only while held |
| **Tap-to-talk** | Menu bar click | M7 | Active until silence detected |
| **Wake word** | "Hey FRIDAY" | M7+, **opt-in** | Rolling buffer, continuously discarded |
| **Continuous** | Conversation mode | M8, opt-in, time-limited | Active for a bounded session |

### Why push-to-talk is the default

Three reasons, in order of weight:

1. **It is verifiable.** You know exactly when the microphone is on because you are holding a key.
   No amount of documentation about wake word privacy is as convincing as physical control.
2. **It is more accurate.** No false activations from the television, no missed activations from
   background noise.
3. **It costs nothing.** No background process, no CPU spent listening, no battery drain.

Wake word is genuinely useful — hands full, across the room — and it will exist. It is opt-in
because it should be a decision you make once you trust the system, not a default you discover.

### Wake word privacy specifics

When enabled:

- A rolling 2-second buffer is held in memory and **continuously overwritten**. Nothing is retained.
- Detection runs entirely on-device via a small neural model. No audio is transmitted, ever.
- On detection, the buffer plus subsequent audio goes to transcription. On no detection, it is
  discarded.
- **The macOS microphone indicator is always visible when the wake word is active.** This is an
  OS-level guarantee FRIDAY cannot suppress — which is exactly why it is worth relying on.
- A visible dashboard indicator shows listening state, and the menu bar icon changes.
- **A hardware mute is respected absolutely.** If your microphone is muted at the OS level, FRIDAY
  reports that she cannot hear rather than trying to work around it.

---

## Voice and approvals

Voice creates a genuine problem for Article III, and it deserves a direct answer rather than a
convenient one.

**Can you approve a consequential action by voice?**

| Risk class | By voice? |
|---|---|
| `low` | Yes — auto-approved anyway |
| `medium` | Yes, with the full explanation read aloud and an explicit confirmation |
| `high` | **No.** Requires a visual surface — you must see the preview. |
| `critical` | **No.** Requires visual plus step-up biometric authentication. |
| `self_modification` | **No.** Desktop only, diff visible. |

**Why high-risk approvals cannot be granted by voice.** Principle 7 requires that you understand
what you are approving — what, why, confidence, alternatives, risks. A spoken summary of an email
is not the email. A spoken description of a $4,000 transfer is not the transfer details. Approval
requires seeing the actual artifact ([Chapter 19](19-approval-system.md)), and voice cannot deliver
that.

There is also a security dimension: **voice is not authentication.** Speaker recognition is
defeatable by recordings and increasingly by synthesis. Anyone in the room can speak. Anyone through
an open window can speak. Voice identifies *an utterance*, never *a person*, and FRIDAY treats it
accordingly.

So FRIDAY's response to a high-risk voice request is: *"That needs your approval — I've sent it to
your Mac."* The work continues; the authorization moves to a surface that can carry it.

---

## Personality and speech

The Manifesto is specific about how FRIDAY should feel: calm, clear, not demanding, respectful of
attention. In voice, that means:

| Rule | Reason |
|---|---|
| **Answer first, explain second.** "Three meetings tomorrow. Want the details?" | Respects attention (Article IX) |
| **State uncertainty aloud.** "I think it's at 3, but I last checked this on Monday." | Principle 3 — admitting uncertainty |
| **Never fill silence.** No "let me think about that." | Calm, not performative |
| **Interruptible mid-sentence.** Speaking stops immediately on new input. | Respect |
| **Match ambient volume and time of day.** Quieter at night. | Calm |
| **Never use urgency the situation does not have.** | Article IX; no manufactured engagement |
| **Confirm before consequential action, always.** | Article III |

**A consistent voice, chosen once.** Principle: *"Her personality, values, and principles must remain
constant even as her capabilities evolve."* The voice is part of identity. Changing it should feel
like a deliberate decision, not an incidental effect of a model upgrade — which is a real risk with
cloud TTS providers, and a reason to prefer a local model whose weights you control.

---

## Latency

Voice is unforgiving. A pause longer than about a second reads as broken.

| Stage | Target | Notes |
|---|---|---|
| Wake word detection | < 200 ms | Local, small model |
| End-of-speech detection | < 300 ms | Silence threshold |
| Transcription | < 500 ms | whisper.cpp on Apple Silicon, small model |
| Intent + response start | < 1,500 ms | Streaming — speech begins before the full answer exists |
| **Perceived total** | **< 2 s** | The number that matters |

The technique that makes this achievable is **streaming synthesis**: FRIDAY begins speaking the first
sentence while later sentences are still being generated. Without it, a 4-second model response
means 4 seconds of silence and the interaction feels broken.

Full budgets in [Chapter 35](35-performance-goals.md).

---

## Alternatives considered

### Cloud speech recognition (Whisper API, Deepgram, AssemblyAI)

**Advantages:** better accuracy, especially for accents, background noise, and unusual vocabulary. No
local compute. Faster on modest hardware.

**Rejected without qualification.** It means audio from your home leaves your machine. This is the
clearest Article IV violation available in the whole design, and the accuracy gain does not come
close to justifying it. Apple Silicon runs whisper.cpp fast enough and accurately enough.

### macOS built-in speech recognition

**Advantages:** free, fast, well-integrated, on-device for many languages.

**Rejected as primary** because behavior varies by macOS version, control over the model is limited,
and it strands Windows and Linux permanently. **Worth revisiting as an optional backend** on macOS
specifically if whisper.cpp proves too slow on older hardware.

### Cloud text-to-speech as default (ElevenLabs, OpenAI, Cartesia)

**Advantages:** substantially more natural and expressive than local synthesis. The quality gap here
is larger than on the recognition side.

**Rejected as default** because it means the text of everything FRIDAY says to you goes to a third
party — which frequently includes personal content by inference alone.

**Available as per-utterance opt-in** for non-sensitive content, chosen by the Model Router's
sensitivity policy. Anything classified `private` or above is always synthesized locally,
regardless of settings. The router fails closed.

### A commercial voice assistant SDK (Alexa, Google, Siri integration)

**Rejected** — routes everything through a third party's infrastructure and imposes their interaction
model, their wake word, and their privacy policy on FRIDAY. It is the opposite of vendor
independence (Principle 5) and of Article IV.

### No voice interface at all

**Advantages:** eliminates the highest-privacy-risk surface entirely; saves substantial work.

**Rejected** because voice is where the Manifesto's "the best interface is often the one that
disappears" is most literally realized. Deferring it to M7 rather than eliminating it, and making
always-listening opt-in, addresses the risk without giving up the capability.

### Speaker identification for authentication

**Rejected** — voice biometrics are defeatable by recording and by synthesis, and the technology is
improving on the attacker's side faster than the defender's. Voice identifies an utterance, never a
person. Any authentication requirement uses passkeys or device biometrics
([Chapter 17](17-authentication-authorization.md)).

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Local transcription is less accurate** than the best cloud services, particularly in noise. | Accepted without reservation. Article IV is not negotiable here. |
| **Local TTS sounds less natural** than the best cloud voices. | Accepted as default; cloud available per-utterance for non-sensitive content. |
| **Local models consume CPU and memory** (~1–2 GB resident for whisper). | Accepted — loaded on demand, unloaded when idle. |
| **Push-to-talk is less magical** than always-listening. | Accepted as the default. Wake word exists as an earned, opt-in capability. |
| **High-risk approvals cannot be granted by voice**, which will occasionally be inconvenient. | Accepted — approval requires seeing what you approve. |
| **Voice adds a large surface** to build, test, and maintain. | Accepted — deferred to M7 so it is built on a proven core. |

---

## Review triggers

- Local transcription accuracy proves inadequate in real use → evaluate a larger local model before
  ever considering cloud
- Voice latency exceeds the 2-second perceived budget
- Wake word false-activation rate exceeds ~1/day
- Apple Silicon performance changes materially (better or worse)
- A local TTS model reaches cloud-comparable quality → remove the cloud option entirely

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
