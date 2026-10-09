# Stoplight v0.1 Release Status

This is the concise ship checklist for the first release, reconciled to the current workspace on 2026-10-09.

## Closed

- [x] `README.md` documents prerequisites, build/install steps, usage, limits, and the release artifact workflow.
- [x] Chrome Web Store copy explains the product and the `debugger`, `tabs`, `sidePanel`, `storage`, and `activeTab` permissions.
- [x] Privacy/data-handling copy is in place.
- [x] GitHub Actions CI defines Rust fmt/test plus extension typecheck/unit/build.
- [x] Local release checks passed in this workspace on 2026-10-09: `cargo fmt --all --check`, `cargo test --workspace --locked`, `npm run typecheck`, `npm test`, and `npm run build`.
- [x] `npm run test:e2e` passed the deterministic unpacked-extension smoke and core release-flow paths on 2026-10-09: the unpacked extension shell loaded, the side panel rendered its core controls, the background service worker target appeared, the website target was armed while the extension panel was active, a JSON POST paused before the server received it, Continue Edited delivered modified headers/body, detach cleared a held request, and Play All released queued requests in arrival order.
- [x] A local demo server exists under `demo/`, and a defense/demo deck exists under `outputs/stoplight-defense-2026-10-09/`.

## Open

- [ ] Automated release evidence for multipart, binary, and static-asset handling. The Playwright source still carries explicit skips for the nondeterministic static-asset and multipart cases, and no passing artifact closes binary behavior.
- [ ] Manual Chrome acceptance on a clean profile. No manual-acceptance note landed in the workspace during this reconciliation.
- [ ] Release screenshots. `docs/screenshots/` still contains only the placeholder README.
- [ ] Native Chrome side panel acceptance. The Playwright harness opens the extension page in headed Chromium, but does not prove the native Chrome side panel shelf.

## Release Artifacts

- Build artifacts are intentionally not committed: `extension/src/generated/stoplight_wasm/` and `extension/dist/`.
- The unpacked extension to ship and test is `extension/dist/`.
- Release evidence is tracked in [`v0.1 Release QA Package`](./v0.1-qa-package.md).
