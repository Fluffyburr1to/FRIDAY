# ADR-0013 — Speech processing is local-only

- **Status:** accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner, Engineering Lead
- **Related:** [Bible 25](../01-bible/25-voice-architecture.md)

## Context

Voice is the interface that most makes FRIDAY feel like FRIDAY. It also carries the highest privacy
stakes in the system: an always-listening microphone in a home is among the most intrusive things
software can ask for, and every major voice assistant has had an incident where recordings were
retained, transmitted, or reviewed by humans in ways users did not expect.

Article IV is not ambiguous: *"prefer local processing whenever practical."*

## Decision

**Audio never leaves the machine. Ever. Under any configuration.**

Wake word (openWakeWord), speech-to-text (whisper.cpp), and speech synthesis (Piper) all run locally
as sealed child processes with no network capability. Raw audio is held in memory, transcribed, and
the buffer zeroed — never written to disk, cached, logged, or attached to an event.

**Push-to-talk is the default.** Wake word is opt-in, added once trust is earned, with the macOS
microphone indicator always visible — an OS-level guarantee FRIDAY cannot suppress.

Cloud TTS is available per-utterance for non-sensitive content only; anything `private` or above is
always synthesized locally regardless of settings.

## Constitutional review

- **Article IV (Privacy):** the clearest possible application. This is where "prefer local
  processing" is least negotiable.
- **Principle 3 (Trust Is Earned):** asking for an always-on microphone on day one is asking for
  trust that has not been earned. Push-to-talk is verifiable — you know the microphone is on
  because you are holding a key.

## Alternatives considered

### Cloud speech recognition (Whisper API, Deepgram, AssemblyAI)
**Advantages.** Better accuracy, especially with accents, background noise, and unusual vocabulary.
No local compute; faster on modest hardware.
**Why rejected without qualification.** Audio from the owner's home would leave the machine. This is
the clearest Article IV violation available in the whole design, and the accuracy gain does not come
close to justifying it. Apple Silicon runs whisper.cpp fast enough and accurately enough.

### macOS built-in speech recognition
**Advantages.** Free, fast, well-integrated, on-device for many languages.
**Why rejected as primary.** Behavior varies by macOS version, model control is limited, and it
strands Windows and Linux permanently. **Worth revisiting as an optional macOS backend** if
whisper.cpp proves too slow on older hardware.

### Cloud text-to-speech as the default (ElevenLabs, OpenAI, Cartesia)
**Advantages.** Substantially more natural than local synthesis — the quality gap is larger here
than on the recognition side.
**Why rejected as default.** The text of everything FRIDAY says would go to a third party, which
frequently includes personal content by inference alone. **Available as per-utterance opt-in** for
non-sensitive content.

### A commercial voice assistant SDK (Alexa, Google, Siri)
**Why rejected.** Routes everything through a third party and imposes their interaction model, wake
word, and privacy policy on FRIDAY. The opposite of Principle 5 and Article IV.

### Speaker identification for authentication
**Why rejected.** Voice biometrics are defeatable by recording and by synthesis, and the technology
is improving faster for attackers than defenders. **Voice identifies an utterance, never a person.**

## Consequences

**Positive**
- A categorical, verifiable privacy guarantee rather than a policy promise.
- Works offline.
- A consistent voice the owner controls, rather than one that changes when a vendor updates a model.

**Negative**
- Local transcription is less accurate than the best cloud services, particularly in noise.
- Local TTS sounds less natural.
- ~1–2 GB resident while loaded; mitigated by loading on demand and unloading when idle.
- `high` and `critical` approvals cannot be granted by voice — approval requires *seeing* the
  artifact, and voice cannot deliver that.

## Reversibility

- **Cost to reverse:** low technically, but reversing would breach the strongest privacy commitment
  in the project. Treat as constitutional.

## Review triggers

- Local transcription accuracy proves inadequate → evaluate a **larger local model** before ever
  reconsidering cloud
- Voice latency exceeds the 2-second perceived budget
- Wake word false-activation rate exceeds ~1/day
- A local TTS model reaches cloud-comparable quality → remove the cloud option entirely
