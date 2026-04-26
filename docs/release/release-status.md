# Stoplight v0.1 Release Status

This is the concise ship checklist for the first release, reconciled to the current workspace on 2026-04-26.

## Closed

- [x] `README.md` documents prerequisites, build/install steps, usage, limits, and the release artifact workflow.
- [x] Chrome Web Store copy explains the product and the `debugger` permission.
- [x] Privacy/data-handling copy is in place.
- [x] GitHub Actions CI defines Rust fmt/test plus extension typecheck/unit/build.
- [x] Local release checks passed in this workspace on 2026-04-26: `cargo fmt`, `cargo test`, `npm run typecheck`, `npm test`, and `npm run build`.
- [x] `npm run test:e2e` passed the deterministic unpacked-extension smoke and core release-flow paths on 2026-04-26: the unpacked extension shell loaded, the side panel rendered its core controls, the background service worker target appeared, a JSON POST paused before the server received it, Continue Edited delivered modified headers/body, and Play All released queued requests in arrival order.

## Open

- [ ] Automated release evidence for detach, multipart, binary, and static-asset handling. The Playwright source still carries explicit skips for the nondeterministic static-asset and multipart cases, and no passing artifact closes detach or binary behavior.
- [ ] Manual Chrome acceptance on a clean profile. No manual-acceptance note landed in the workspace during this reconciliation.
- [ ] Release screenshots. `docs/screenshots/` still contains only the placeholder README.

## Release Artifacts

- Build artifacts are intentionally not committed: `extension/src/generated/stoplight_wasm/` and `extension/dist/`.
- The unpacked extension to ship and test is `extension/dist/`.
- Release evidence is tracked in [`v0.1 Release QA Package`](./v0.1-qa-package.md).
