# launchd — Keeping FRIDAY Alive

`com.friday.core.plist` — the macOS LaunchAgent definition. Installed to
`~/Library/LaunchAgents/`.

See [infra/README.md](../README.md) for the settings and the sleep/wake behavior.

## Why a LaunchAgent rather than a LaunchDaemon

A LaunchAgent runs as **you**, in your login session, with access to **your Keychain**. A
LaunchDaemon runs as root at boot, which would mean FRIDAY holds more privilege than she needs and
cannot reach the Keychain entries protecting your credentials.

Least privilege (Article V), applied at the level of process ownership.

## Commands

```bash
launchctl load   ~/Library/LaunchAgents/com.friday.core.plist
launchctl unload ~/Library/LaunchAgents/com.friday.core.plist
launchctl list | grep friday
```
