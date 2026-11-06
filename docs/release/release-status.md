# Stoplight public alpha status

Updated 2026-11-06. The distribution is a public GitHub prerelease plus a ready-to-load extension ZIP. The [alpha contract](v0.1-qa-package.md#public-alpha-contract--2026-11-06) defines the thresholds; the [verification receipt](alpha.1-verification.md) records evidence and limits.

**A1–A6: GO for `v0.1.0-alpha.1`. A7: pending public download/install verification.**

| Gate | Result |
| --- | --- |
| A1 Candidate/build | PASS: clean compiled source `48c3d6f`, 24 Rust tests, 37 TypeScript tests, typecheck, build and hosted CI. Final tag input equality and CI are checked before publication. |
| A2 Browser behavior | PASS: 36 automated cases and 13 independent core repeat cases without failures/skips/retries; native panels and request flows in two fresh profiles. |
| A3 Defects/dependencies | PASS: source concerns resolved, exact-artifact acceptance passed, npm audit zero findings. Rust advisory scanner unavailable; no scanner pass claimed. |
| A4 Package/install | PASS: exact ZIP/checksum/inventory, fresh native Load unpacked and removal. |
| A5 Docs/privacy | PASS: permissions, retention, feedback, install and manual replacement/removal match observed behavior. |
| A6 Decision | GO under the maintainer’s conditional publication authorization; final source identity and CI must be confirmed before publishing. |
| A7 Public delivery | Pending: anonymously download the public ZIP/checksum/source, match hashes, fresh install/core flow and detach/uninstall before announcing a verified alpha. |

ZIP: `stoplight-v0.1.0-alpha.1.zip`; SHA-256 `0fdd1f12e99a0c6b62df3cf6481c7c25039c124f033dae4a9ce2e2d130f49405`. Compiled source: `48c3d6f60e7b14d1e0b908decda2b67fda2a5cac`. Later tag changes contain tests/documentation only; the ZIP retains its compiled identity.

Tested on macOS 26.0.1 ARM64 with Google Chrome 156.0.8078.80 and Chrome for Testing 145.0.7632.6. Other operating systems/versions are unverified. Chrome Web Store submission, marketing screenshots and broader platform coverage remain deferred. Manual replacement was rehearsed with the same candidate ZIP; no cross-version migration or prior-release rollback is claimed. First-alpha rollback is detach, disable and remove.
