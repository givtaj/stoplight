# Stoplight public alpha status

Updated 2026-11-06. The distribution target is a public GitHub prerelease plus a ready-to-load extension ZIP. The [alpha contract](v0.1-qa-package.md#public-alpha-contract--2026-11-06) defines the thresholds; the [selected verification receipt](alpha.1-verification.md) records evidence and limits.

**Decision: native acceptance is still in progress; publication is pending.**

| Gate | Current result |
| --- | --- |
| A1 Candidate/build | PASS: clean compiled source `48c3d6f`, 24 Rust tests, 37 TypeScript tests, typecheck, build and hosted CI. |
| A2 Browser behavior | 36 automated cases PASS with no skips/retries; first native Chrome 156 check PASS; independent second profile pending. |
| A3 Defects/dependencies | Source concerns resolved and regressions pass; npm audit zero findings. Final native acceptance pending. |
| A4 Package/install | Exact ZIP and checksum independently verified; fresh native installation PASS. |
| A5 Docs/privacy | Install, manual replacement/removal, retention, permissions and feedback documented; documented manual replacement PASS. |
| A6 Decision | NO-GO until all A1–A5 evidence is complete. Maintainer has authorized publication once these gates pass. |
| A7 Public delivery | Not run; follows publication and must pass before the alpha is announced as verified. |

The tested ZIP is `stoplight-v0.1.0-alpha.1.zip`, SHA-256 `0fdd1f12e99a0c6b62df3cf6481c7c25039c124f033dae4a9ce2e2d130f49405`. Runtime source is `48c3d6f60e7b14d1e0b908decda2b67fda2a5cac`; later test/documentation commits must preserve every build/package input. The artifact is unchanged by test-harness corrections.

Chrome Web Store submission, marketing screenshots, other operating systems and a wider Chrome version matrix are deferred. Native-panel acceptance itself is required. First-alpha rollback is detach, disable and remove; there is no earlier published release or automatic updater.
