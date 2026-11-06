# Changelog

All notable changes to this project should be recorded in this file.

The format is based on Keep a Changelog, adapted for the current pre-release phase.

## [Unreleased]

### First public alpha candidate

- Ready-to-load Manifest V3 extension ZIP, source identity, SHA-256 checksum, license and dependency notices.
- Explicit website target and origin allowlist; pause Fetch/XHR, inspect requests, edit supported text and headers, continue originals or edits, release queued originals in FIFO order, and detach/re-arm.
- Original byte preservation for unchanged requests, multipart/file/binary inspect-only behavior, explicit unavailable/truncated capture state and safe empty textual edits.
- Session-generation and arrival-order guards, strict edit validation, storage/continuation failure recovery, reviewed target identity and duplicate-send protection.
- Updated Vite/Vitest dependency set with zero npm audit findings and an accurate Node build range.
- Clean-build verification, 24 Rust tests, 37 TypeScript tests and 36 browser acceptance cases without skips or retries. Native-profile acceptance and public acquisition are recorded in the [release receipt](docs/release/alpha.1-verification.md).
- Install, permissions, privacy, manual replacement/removal, feedback and alpha limitations documented.

## Development history

The initial implementation and earlier QA snapshots are recorded in [TASKLOG.md](TASKLOG.md) and the [historical QA package](docs/release/v0.1-qa-package.md). Results from those snapshots do not certify the selected alpha ZIP.
