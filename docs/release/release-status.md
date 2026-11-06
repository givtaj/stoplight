# Stoplight v0.1 Release Status

This is the concise ship checklist for the first public alpha, updated on 2026-11-06. The authoritative thresholds are in the [Public Alpha Contract](./v0.1-qa-package.md#public-alpha-contract--2026-11-06).

## Public Alpha Decision

**NO-GO for `v0.1.0-alpha.1` at this review.** The chosen channel is a public repository plus a prebuilt ZIP for Developer mode / Load unpacked. [givtaj/stoplight](https://github.com/givtaj/stoplight) was created public and configured as `origin`; it is empty at this review. No source push, alpha tag, ZIP or public install verification has been completed by this task.

| Gate | Status at policy creation | Finish condition |
| --- | --- | --- |
| A1 Candidate/build | Original baseline passed; new candidate pending | Clean committed candidate and all required checks pass with exact-SHA evidence. |
| A2 Browser matrix | Incomplete | B1–B10 pass on the same ZIP; core B1–B4 pass again in a second clean profile. |
| A3 Defects | Fixes and dependency remediation prepared; artifact checks pending | Source regressions pass and npm audit reports zero findings. Final browser proof and review must close the gate on the selected ZIP. |
| A4 Package | Pending | Versioned loadable ZIP, source/version mapping, inventory and checksum verified. |
| A5 Public docs/privacy | Partial | Existing drafts reconciled with tested behavior, retention, permissions, install/update/removal, feedback and public-source scope. |
| A6 Decision | NO-GO | Maintainer records GO with A1–A5 receipts and no unresolved blockers. |
| A7 Public delivery | Not run | Tagged public source and approved ZIP downloaded anonymously, hash matched, installed and smoke-tested. |

The initial repository review is complete, and **Review Stoplight repository state** is now implementing fixes and expanded tests in the shared checkout. **Verify public release** completed the [local candidate receipt for `90abfd9`](./v0.1-qa-package.md#local-candidate-receipt--2026-11-06--90abfd9): 15 Rust tests, 15 TypeScript tests, build and five browser tests passed; two browser tests remained skipped. The receipt also records eight dependency audit findings and the Node prerequisite mismatch. Raw evidence is under `outputs/release-verification/2026-11-06/` (local receipt: `outputs/release-verification/2026-11-06/`). These results do not validate the subsequent edits or public delivery. Freeze the new candidate and update this table from its exact-artifact evidence.

## Historical Completed Work — 2026-10-09

- [x] `README.md` documents prerequisites, build/install steps, usage, limits, and the release artifact workflow.
- [x] Chrome Web Store copy explains the product and the `debugger`, `tabs`, `sidePanel`, `storage`, and `activeTab` permissions.
- [x] Privacy/data-handling copy is in place.
- [x] GitHub Actions CI defines Rust fmt/test plus extension typecheck/unit/build.
- [x] Local release checks passed in this workspace on 2026-10-09: `cargo fmt --all --check`, `cargo test --workspace --locked`, `npm run typecheck`, `npm test`, and `npm run build`.
- [x] `npm run test:e2e` passed the deterministic unpacked-extension smoke and core release-flow paths on 2026-10-09: the unpacked extension shell loaded, the side panel rendered its core controls, the background service worker target appeared, the website target was armed while the extension panel was active, a JSON POST paused before the server received it, Continue Edited delivered modified headers/body, detach cleared a held request, and Play All released queued requests in arrival order.
- [x] A local demo server exists under `demo/`, and a defense/demo deck exists under `outputs/stoplight-defense-2026-10-09/`.

## Remaining Alpha Work

- [ ] Resolve the request-preservation and recovery concerns recorded in the QA package, with regression evidence.
- [ ] Complete B1–B10 on the packaged candidate, including static assets, multipart, binary and actual native Chrome side-panel acceptance. Recorded manual edge-case proof is acceptable for alpha; skipped tests are not proof.
- [ ] Verify clean-profile installation and repeat the core flow on the same artifact.
- [ ] Complete the source, ZIP, checksum, public instructions and privacy evidence.
- [ ] Record pre-publication GO, then verify the anonymous public download/install path before announcing a verified alpha.

Store submission, marketing screenshots and automating manually proven edge cases are deferred beyond the first developer alpha. The native-panel proof itself remains mandatory.

## Release Artifacts

- Build artifacts are intentionally not committed: `extension/src/generated/stoplight_wasm/` and `extension/dist/`.
- Package the contents of `extension/dist/` as the versioned release ZIP; test that exact ZIP after extraction. A source archive is a separate artifact.
- Release evidence is tracked in [`v0.1 Release QA Package`](./v0.1-qa-package.md).
