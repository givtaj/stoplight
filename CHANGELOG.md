# Changelog

All notable changes to this project should be recorded in this file.

The format is based on Keep a Changelog, adapted for the current pre-release phase.

## [Unreleased]

### Added

- Browser regressions for multipart file bytes, non-UTF-8 and empty binary bodies, PNG uploads, static image loading while an API request is held, and clearing an edited body.
- Native Chrome 156 acceptance evidence and idle, paused-editor, binary inspect-only, and detached screenshots from a fresh signed-out profile on 2026-11-06.

- Explicit arm target state so the side panel can show the website tab that will be armed before attaching Chrome debugger.
- Request phase state for waiting, held, forwarded, detached, and error UI.
- Browser E2E coverage for arming the shown website target while the extension panel has focus, detach while a request is held, edited request forwarding, and FIFO Play All.
- Local reviewer demo and defense deck artifacts for project evaluation.
- Root README covering prerequisites, build/install steps, usage, limits, and release workflow.
- Chrome Web Store copy with short/long descriptions and permission explanations.
- Privacy and data-handling documentation for the first release.
- Release QA package documenting automated smoke coverage, manual browser validation, and screenshot status.
- Release-status summary for the v0.1 ship checklist.
- GitHub Actions CI covering Rust fmt/test and extension typecheck/unit/build.
- Rust workspace scaffolding with `crates/core` and `crates/wasm`.
- Chrome MV3 extension scaffold under `extension/`.
- Baseline extension manifest with `debugger`, `sidePanel`, `storage`, and `activeTab` permissions.
- WASM-compatible MV3 content security policy for extension pages.
- TypeScript build, typecheck, unit-test, and Playwright E2E script setup in the extension package.

### Fixed

- Replaced the malformed static-image fixture and isolated initial navigation/favicon traffic in browser tests; removed both skipped cases.
- Explicit nontext MIME types remain inspect-only even when Chrome omits body data; both editing controls and worker commands enforce the unchanged-only contract.
- Continue Unchanged and Play All preserve Chrome’s original headers/body without reconstruction. Empty textual edits explicitly send zero bytes.
- The demo now sends binary fixtures, exposes exact received bytes, and updates its count without generating extra intercepted log requests.

### Changed

- Manifest permissions now include `tabs` so Stoplight can validate the intended website target and avoid arming its own extension panel when the panel has focus.
- Side panel copy now distinguishes forwarding from remote receipt or durable persistence.
- Release proof now records the 2026-10-09 workspace rerun of fmt/test/typecheck/Vitest/build and the Playwright release-flow result (`5 passed, 2 skipped`).
- Release proof now records the 2026-04-18 workspace rerun of fmt/test/typecheck/Vitest/build and the Playwright smoke result (`1 passed, 2 skipped`) instead of older repo-baseline wording.
- Release QA docs now explicitly state that no manual Chrome acceptance artifact or release screenshots are present in the workspace yet.
- Project planning is now tracked in [PLAN.md](./PLAN.md) with companion work-tracking files for ongoing implementation.
- Task tracking now reflects the implemented Rust core, debugger controller, side panel UI, CI, and release-facing docs.
- Release workflow now documents generated WASM and `extension/dist/` as build artifacts.
- Release proof now distinguishes passing automated checks, partial browser E2E coverage, and the remaining manual Chrome acceptance/screenshots.

### Notes

- Tracking starts on 2026-03-25.
- Keep entries focused on meaningful architectural, behavioral, and developer-workflow changes.
