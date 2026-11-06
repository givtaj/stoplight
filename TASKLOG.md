# Task Log

Lightweight implementation tracker for the work defined in [PLAN.md](./PLAN.md).

## Working Notes

- Update this file as tasks move between sections.
- Keep the newest dated log entry at the top of the log.
- Use the changelog for notable project changes and this file for day-to-day implementation state.

## Current Snapshot

- Last updated: 2026-11-06
- Public alpha target: `v0.1.0-alpha.1`, public repository plus prebuilt ZIP. [Alpha gates](docs/release/v0.1-qa-package.md#public-alpha-contract--2026-11-06) are defined; release decision is NO-GO pending candidate evidence and source-review concerns.
- Public repository created at `https://github.com/givtaj/stoplight` and configured as `origin`; no source push or release was made by the threshold-setting task.
- Baseline observed in repo: the Rust core, WASM bridge, MV3 extension shell, side panel UI, background controller, GitHub Actions CI, local demo server, and deterministic extension release-flow coverage are implemented.
- The 2026-10-09 release-proof rerun reconfirmed fmt/workspace tests, extension typecheck, Vitest, build, and headed Chromium Playwright coverage for smoke, explicit website target arming, edited request forwarding, detach, and FIFO release.
- Expected workflow: multiple agents may update the implementation in parallel, so keep entries short and append-only where possible.

## Done

- [x] Rust workspace created with `crates/core` and `crates/wasm`.
- [x] Extension package scaffold created under `extension/`.
- [x] MV3 manifest baseline added with side panel, background worker, permissions, and WASM CSP.
- [x] Initial TS build/test scripts added for Vite, Vitest, and Playwright.
- [x] Tracking files created for changelog and task progress.
- [x] Rust request normalization, body decoding, diffing, and session reduction implemented.
- [x] Background debugger controller implemented for arm, queue, continue, detach, and allowlist flow.
- [x] Side panel UI implemented for queue inspection and request editing.
- [x] Local build and unit test paths verified.
- [x] Deterministic browser smoke verifies the unpacked extension loads and the side panel/background worker come up.
- [x] GitHub Actions CI added for Rust fmt/test and extension typecheck/unit/build.
- [x] Release-facing docs added for setup, usage, privacy, store copy, release status, and release QA.
- [x] Release proof reconciled to the current workspace on 2026-04-18 with local fmt/test/typecheck/Vitest/build results and the current Playwright smoke outcome.
- [x] Side panel now shows an explicit arm target, rejects Stoplight/internal pages before debugger attach, and requires the shown target ID when arming.
- [x] Request phase labels now distinguish waiting, held, edited-held, forwarded, detached, and error states without claiming durable receipt.
- [x] Browser E2E coverage now proves edited request forwarding, detach clearing a held request, FIFO Play All, and arming the shown website target while the extension panel has focus.
- [x] A local demo server and defense deck are available under `demo/` and `outputs/` for reviewer walkthroughs.

## In Progress

- [ ] Browser evidence for static assets, multipart inspect-only behavior, and binary handling. The historical 2026-10-09 Playwright result was `5 passed, 2 skipped`; manual proof on the exact candidate may close alpha behavior gates while automation remains backlog.
- [ ] Resolve the alpha source-review concerns: empty-body edits, binary/missing-body classification, unchanged request preservation and held-request recovery.
- [ ] Manual Chrome acceptance on a clean Chrome profile. No acceptance artifact is present in the workspace as of 2026-10-09.

## Next Up

- [ ] Complete A1–A6 and package `v0.1.0-alpha.1`; verify public delivery under A7 before announcing a verified alpha.
- [ ] Capture marketing screenshots for later store publication; they are not a developer-alpha blocker.

## Log

### 2026-11-06 — Public alpha completion

- Maintainer authorized coordination of both active chats, closing the remaining alpha gates, and publishing after they pass.
- Implementation lane prepared capture provenance, FIFO and session-generation guards, persistence-failure recovery, reviewed arm-target identity, strict edit validation and 35 browser scenarios. Fast checks passed 24 Rust and 37 TypeScript tests; the expanded browser matrix awaits the frozen ZIP.
- Dependency lane updated Vite/Vitest/transitives with zero npm audit findings and validated installation/typecheck/unit/build on Node 20.19.0. Final clean-source validation is still required.
- Release lane added alpha manifest identity, install/update/privacy documentation, dependency notices and packaging bound to a source/build inventory. Synthetic packaging checks reject changed assets, missing chunks and wrong source identity.
- Raw local evidence and unrelated presentation output remain outside the publication set. Public release remains conditional on A1–A7; no alpha has been published at this checkpoint.

### 2026-11-06

- Reviewed the two release-related chats and existing source/QA evidence. Defined A1–A7 and browser scenarios B1–B10 in the existing QA package, keeping historical results separate from current candidate approval.
- Set zero-tolerance gates for request corruption, wrong-target interception, unintended disclosure, failed install/core behavior, duplicate sends and unrecoverable held requests. Allowed documented manual edge-case proof for alpha.
- Maintainer selected public repository plus prebuilt ZIP. Created public `givtaj/stoplight` via `gh` and added `origin`; source publication and alpha delivery remain pending.
- Deferred store approval, marketing screenshots and broader platform coverage. No implementation change, test run, source push or release publication was performed by this threshold-setting task.

### 2026-10-09

- Re-ran release-relevant automated checks: `cargo fmt --all --check`, `cargo test --workspace --locked`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`.
- Recorded the current browser automation result as Playwright `5 passed, 2 skipped`, with passing proof for smoke, explicit website target arming while the panel is active, edited JSON forwarding, detach clearing a held request, and FIFO Play All.
- Added explicit arm-target state and request-phase state across the shared TypeScript model, Rust reducer, controller, and side panel UI.
- Added the `tabs` permission so Stoplight can show and validate the intended website target before arming when the extension panel has focus.
- Created a local defense deck and preserved the existing local demo server for manual reviewer walkthroughs.

### 2026-04-18

- Re-ran the release-relevant automated checks: `cargo fmt --all --check`, `cargo test --workspace --locked`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`.
- Recorded the current browser automation ceiling as Playwright `1 passed, 2 skipped`, which closes smoke coverage but not the release flow.
- Confirmed that no manual Chrome acceptance note or screenshot files are present in the workspace, and updated the release proof to match.

### 2026-04-11

- Reconciled the release checklists with the current repo truth.
- Marked CI and release-facing documentation as complete.
- Kept browser release-flow E2E, manual Chrome acceptance, and screenshots open because they still require browser evidence.

### 2026-03-25

- Initialized `CHANGELOG.md` and `TASKLOG.md`.
- Captured current scaffold state from `PLAN.md`, workspace manifests, and extension manifest.
- Set up a simple split between notable changes (`CHANGELOG.md`) and active implementation tracking (`TASKLOG.md`).

### 2026-04-04

- Refreshed the tracker to match the current implementation state.
- Added release-facing documentation for setup, usage, privacy, and Chrome Web Store copy.
- Documented the generated WASM and extension bundle workflow as build artifacts.
- Recorded the deterministic browser smoke coverage and the remaining manual Chrome validation path for v0.1.
