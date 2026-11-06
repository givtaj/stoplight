# Alpha source and public-history review — 2026-11-06

Result: no credential candidate was identified in the tracked history by this bounded review. Four correctness concerns remain release blockers in the reviewed working snapshot. This is source-review evidence, not a browser or test result, and must be reconciled with later concurrent fixes.

## Scope and evidence limits

- Read both existing commits, `78ff7d4` and `90abfd9`: 76 unique tracked blobs.
- Scanned textual blobs for common private-key/token formats, credential literals, authenticated URLs, personal email and local home paths. Inspected commit identity metadata separately.
- Inspected the tracked October PPTX's seven slides, seven notes parts, metadata, relationships and embedded workbook XML. Visually inspected its montage; all seven PNG previews had no text/EXIF metadata chunks. The deck contains project review and synthetic demo content, with dated evidence limits. No private customer content or credential candidate was identified.
- Scanned 114 current modified/untracked text or PPTX files at the review snapshot. Inspected all four new native-panel screenshots plus the DevTools coexistence screenshot; their visible request examples use the local synthetic demo.
- No tests, builds, browser sessions, staging, commits, pushes, history changes or source edits were performed for this review. The only added file is this sanitized report.
- This is not exhaustive secret detection, OCR of every raster pixel, or a formal security audit. It does not approve future files added to the publication set.

## Public-source contents

The source and historical presentation content reviewed do not contain an identified credential or private traffic sample. Keep the publication set explicit; do not stage all of `outputs/`.

| Path or object | Observed contents | Publication handling |
| --- | --- | --- |
| `outputs/stoplight-defense-2026-10-09/validation-summary.json`, lines 2, 3, 82, 83 | Local home/build/cache paths, including the workstation account identifier | Prefer omission from a fresh public source snapshot, or sanitize to repository-relative/placeholder paths if included. It already exists in `90abfd9`; changing the tip does not remove it from history. This is personal metadata, not an identified credential. |
| Commit objects `78ff7d4`, `90abfd9` | Existing personal author/committer email | Ordinary Git identity metadata becomes public when preserving this history. Record that publication consequence; a tip-only author change does not alter existing commits. No identity values are reproduced here. |
| `outputs/stoplight-defense-2026-10-09/stoplight-defense-demo-2026-10-09-r2.pptx`, its montage and previews | Historical project evaluation, local demo instructions and explicitly dated checks | No sanitization blocker identified. Keep clearly historical; it is not current alpha evidence. |
| `outputs/manual-20260611-stoplight/` | Untracked presentation export outside the chosen release proof | Omit from the initial public source set unless deliberately selected and separately reviewed for publication. |
| `outputs/release-verification/2026-11-06/` and `2026-11-06-updated/` | Raw local receipts, build paths, source snapshots, archives and tool scripts | Preserve locally. Publish a sanitized summary and selected necessary logs, rather than the full directories or redundant source/build archives. |
| `outputs/v0.1-qa-2026-11-06/` | Raw local QA receipts, generated extension output, ZIP, source diff and synthetic network data | Preserve locally. Select sanitized receipts explicitly; distribute the final approved ZIP through release assets instead of committing this intermediate build folder. |
| `docs/screenshots/v0.1-2026-11-06/` | Local synthetic demo, native panel and request editor states | No visible credential/private-traffic candidate identified. Their evidence remains bound to the earlier build they depict, not later fixes. |

Files in current untracked evidence with detected local home paths, if selected for publication:

- `outputs/release-verification/2026-11-06-updated/initial-working-snapshot.json`
- `outputs/release-verification/2026-11-06/candidate.json`
- `outputs/release-verification/2026-11-06/environment.json`
- `outputs/release-verification/2026-11-06/run_check.py`
- `outputs/release-verification/2026-11-06/runtime-identity.json`
- `outputs/release-verification/2026-11-06/runtime-identity.log`
- `outputs/release-verification/2026-11-06/runtime-identity.mjs`
- `outputs/v0.1-qa-2026-11-06/build-approved.json`
- `outputs/v0.1-qa-2026-11-06/build-final.json`
- `outputs/v0.1-qa-2026-11-06/build-final.log`
- `outputs/v0.1-qa-2026-11-06/build.json`
- `outputs/v0.1-qa-2026-11-06/build.log`
- `outputs/v0.1-qa-2026-11-06/candidate.json`
- `outputs/v0.1-qa-2026-11-06/e2e-authorized.json`
- `outputs/v0.1-qa-2026-11-06/e2e-edge-repeat.json`
- `outputs/v0.1-qa-2026-11-06/e2e-final.json`
- `outputs/v0.1-qa-2026-11-06/e2e.json`
- `outputs/v0.1-qa-2026-11-06/rust-format-final.json`
- `outputs/v0.1-qa-2026-11-06/rust-format.json`
- `outputs/v0.1-qa-2026-11-06/rust-tests-final.json`
- `outputs/v0.1-qa-2026-11-06/rust-tests-final.log`
- `outputs/v0.1-qa-2026-11-06/rust-tests.json`
- `outputs/v0.1-qa-2026-11-06/rust-tests.log`
- `outputs/v0.1-qa-2026-11-06/typecheck.json`
- `outputs/v0.1-qa-2026-11-06/unit-tests.json`
- `outputs/v0.1-qa-2026-11-06/unit-tests.log`

## Correctness blockers in the reviewed working snapshot

### R1 — Unavailable textual bodies can be erased

`extension/src/background/controller.ts:438` returns null when body capture is unavailable or fails. `crates/core/src/body.rs:21` converts null to an editable empty body for textual/no MIME types. The new `controller.ts:423` then explicitly sends empty `postData` when the UI submits that draft, including a header-only edit. An unavailable original body can therefore be replaced with zero bytes.

Smallest correction: distinguish bodyless requests from omitted/failed capture using CDP body-presence metadata. Mark unknown/incomplete captured bodies inspect-only and continue them without overrides. Regression evidence: body indicated, omitted inline postData, failed retrieval; editing is rejected and Continue Unchanged sends only the request identifier.

### R2 — Asynchronous body retrieval can invert arrival order

`extension/src/background/index.ts:38` starts pause handlers concurrently. `controller.ts:285` awaits body retrieval before queue insertion. Earlier request A with delayed retrieval can be inserted after later request B with an inline body. Play All uses that reversed queue.

Smallest correction: assign an arrival sequence before awaiting capture and preserve it through queue insertion/release, or serialize pause processing without blocking detach. Regression evidence: delay A's body promise, receive B, then resolve A; displayed and continuation order remain A,B.

### R3 — Capture completion can restore a request after detach

A pause handler awaiting capture can outlive `controller.ts:259` clearing the session. It later inserts the old request at `controller.ts:300` without validating session identity or attached state. This can create a detached session with a phantom held request and restore captured data after detach or into a replacement session.

Smallest correction: record a session generation before awaits, invalidate it on detach/re-arm, and discard stale completions. Regression evidence: delay capture, detach or re-arm another tab, resolve capture; the old request never returns.

### R4 — Storage failure forwards held traffic without user action

`controller.ts:749` mutates in-memory state before awaiting persistence. If storage rejects while queueing, the catch at `controller.ts:306` emits an error and auto-continues the matched request. It remains in the pending map/queue, while the new queue was not emitted. This combines unintended forwarding and a stale UI.

Smallest correction: handle persistence failure separately from capture failure, keep the matched request held, emit the actual queue plus a persistence error, and retain explicit unchanged/detach recovery. Regression evidence: reject storage set while queueing; there is no continuation before explicit action and the held request remains visible/recoverable.

Repeated-click concurrent continuation exists as a source concern, but duplicate server delivery was not established: CDP may reject the second continuation for a consumed request ID. Keep the runtime repeated-click gate; do not report duplicate delivery as an observed defect from this review.

## Reviewed source identity

The findings above refer to uncommitted changes based on `90abfd9`, with these file SHA-256 values. Later changes require targeted re-review.

| File | SHA-256 |
| --- | --- |
| `crates/core/src/body.rs` | `044d4ac3c7227a255859389ffbcf2acb11472c7ef271222c699d0fb8a95f42ed` |
| `extension/src/background/controller.ts` | `05ac77f8a31fd67aec6203756d7bc202349ceb29e03c2401edce8f2c4c38f228` |
| `extension/src/background/index.ts` | `3a3c0745ffbb45be78d8e3af028e06f1f15335929d82891eedca9e0a15707fb6` |
| `extension/src/sidepanel/main.ts` | `d916ad8cecce584118cc8b30c7fce5948d6a7084d26d74e4a1ac47ee9222b182` |

## Targeted follow-up before candidate freeze — 2026-11-06

**Source-review GO for the previously reported concerns in the snapshot below.** R1–R4 are resolved by the inspected implementation and have targeted regression cases. No remaining concrete release blocker was found in the requested body-capture, FIFO, lifecycle, persistence, or arm-target identity review. This supersedes the original source NO-GO above for this snapshot only. It is not the release decision: executed tests, browser gates, packaging and public-download receipts remain separate evidence.

- R1: `body.rs` treats absent capture as unavailable/noneditable. The controller distinguishes known bodyless requests from missing capture using CDP body metadata, checks captured length, bounds previews, labels incomplete capture, rejects edits and sends unchanged requests without header/body overrides. Controller cases at lines 895–909 and 952–964 cover missing/truncated/bodyless/empty and oversized behavior; `alpha-capture.spec.ts` exercises a real browser request larger than one MiB and exact server-side byte preservation.
- R2: `controller.ts:372` serializes pause handling before body lookup; the slow-first-capture regression is at `controller.test.ts:838`.
- R3: generation checks bracket capture; detach and re-arm invalidate previous generations. The stale-completion regression is at `controller.test.ts:855`.
- R4: `controller.ts:867` emits truthful in-memory state before persistence and surfaces failures without auto-forwarding. Storage writes are serialized at line 877. Regression cases at `controller.test.ts:873` and `:927` cover storage rejection and delayed old writes.
- Arm-target identity: expected tab ID and URL, live metadata recheck, serialized arming, generation checks after awaited setup, and rejection of replacement arming when prior detach fails cover the examined paths. Tests at `controller.test.ts:724`–`:778` and `:913` exercise those cases.
- Repeated continuations now have an in-flight guard and explicit regression coverage at `controller.test.ts:781`; a failed continuation remains recoverable.

The possible delayed `onDetach` event after a normal explicit detach was checked against Chromium's implementation rather than promoted as a speculative blocker: `DebuggerDetachFunction::Run` closes the client without the external-detach event path. Source inspected: <https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/extensions/api/debugger/debugger_api.cc>.

No tests or builds were executed during this follow-up. Test source was inspected; its execution results must come from the candidate's validation receipts. Follow-up snapshot SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `crates/core/src/body.rs` | `a9b3043665cd3779945b1351fb5942e103c7aa989ab39d05200d1da4b8263c3d` |
| `crates/core/src/model.rs` | `f50e0e676c696dea5038730d178b6c572642b4f9c14386d1dddfa674d1f4aa81` |
| `crates/core/src/request.rs` | `a443a78f0511874f529dbdb5bb286444ef5d8bec66f6b983b2b6d10cb307d372` |
| `crates/core/src/session.rs` | `482fe55f512ccc81cce58e03f8c18afc77bafd30d5eb7e5d515d56a9a0e3da87` |
| `extension/src/background/controller.ts` | `d2dc32bdfc8d41031c1c0b97503f3b75ec40958822c24fcb2df44e8902b6404a` |
| `extension/src/background/controller.test.ts` | `496dcec41508b9dcd02c91df8370c53d379c228ce19596379a54dc1b7a7323ec` |
| `extension/src/background/index.ts` | `3a3c0745ffbb45be78d8e3af028e06f1f15335929d82891eedca9e0a15707fb6` |
| `extension/src/shared/types.ts` | `52357d0c465a901430a94a2b887def675830e8500c3350463ac1cfcae17c2e7c` |
| `extension/src/shared/utils.ts` | `7cfd6230b16bc71e4423c1d5b1c760555093d04a72ad226bd7fe2aab053829dc` |
| `extension/src/sidepanel/main.ts` | `e9bc626284ff898b412d3275e8f5b43c6d11c33dd00664cfa389d5f35c36219a` |
| `extension/tests/e2e/alpha-capture.spec.ts` | `b5d8baf35a66dc79588d7fb6bae4b2d5699a4305c403f5a3d405f9458799e76f` |
