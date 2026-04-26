# Changelog

All notable changes to this project should be recorded in this file.

The format is based on Keep a Changelog, adapted for the current pre-release phase.

## [Unreleased]

### Added

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

### Changed

- Release proof now records the 2026-04-18 workspace rerun of fmt/test/typecheck/Vitest/build and the Playwright smoke result (`1 passed, 2 skipped`) instead of older repo-baseline wording.
- Release QA docs now explicitly state that no manual Chrome acceptance artifact or release screenshots are present in the workspace yet.
- Project planning is now tracked in [PLAN.md](./PLAN.md) with companion work-tracking files for ongoing implementation.
- Task tracking now reflects the implemented Rust core, debugger controller, side panel UI, CI, and release-facing docs.
- Release workflow now documents generated WASM and `extension/dist/` as build artifacts.
- Release proof now distinguishes passing automated checks, partial browser E2E coverage, and the remaining manual Chrome acceptance/screenshots.

### Notes

- Tracking starts on 2026-03-25.
- Keep entries focused on meaningful architectural, behavioral, and developer-workflow changes.
