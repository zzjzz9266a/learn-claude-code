# TypeScript Mirror Course Sync Design

## Goal

Make this repository a TypeScript mirror of the upstream course structure and website experience.

Success means:

- The chapter map, numbering, ordering, bridge docs, navigation, and generated web content match upstream's current teaching structure.
- The repository and website do not retain or display Python source.
- Existing TypeScript runnable chapters continue to work.
- Every upstream chapter exposed in the mirrored course has a corresponding TypeScript implementation in this repository.

## Non-Goals

- Fully implementing runnable TypeScript agents for `s13` through `s19` in this phase.
- Preserving upstream Python files for reference, diffing, or source viewing.
- Reproducing upstream internals 1:1 when they conflict with the TypeScript-only mirror goal.

## Constraints

- No Python source files should remain in the mirrored teaching surface.
- No page should render Python code snippets from generated data.
- The site must keep building as a static export.
- The existing `s01` through `s12` TypeScript runnable flow must remain valid.
- No `planned` or placeholder chapter state is allowed for mirrored upstream sessions.
- If upstream changes the semantics or key mechanism of an existing chapter, the mirror must update the matching TS implementation in the same synchronization effort.

## Recommended Approach

### Option A: Strict TS-Only Mirror with Immediate TS Translation

Regenerate all teaching metadata from TypeScript source plus markdown docs only. When upstream adds or changes a Python-backed chapter, read that Python chapter as reference input and translate it into a TS implementation before considering the sync complete.

Pros:

- Cleanest long-term architecture.
- Eliminates Python leakage at the source.
- Keeps web components honest about what exists.
- Matches the repository's role as a real TS mirror rather than a documentation shell.

Cons:

- Requires changes to the extraction pipeline and some viewer assumptions.
- Requires larger sync effort whenever upstream adds or reshapes chapters.

### Option B: Hybrid Generated Data with Post-Filter

Keep upstream-shaped generated data, then strip Python-backed records at render time.

Pros:

- Faster to patch initially.

Cons:

- Fragile.
- Easy to leak Python into new pages or metadata.
- Creates persistent mismatch between data truth and UI truth.
- Breaks the requirement that upstream chapters must have real TS implementations instead of placeholders.

### Option C: Hardcoded Mirror Metadata

Manually maintain chapter metadata, page structure, and sync status in static TS files, independent of extraction.

Pros:

- Predictable.

Cons:

- Expensive to maintain.
- Drifts from real docs and source quickly.

### Recommendation

Choose Option A.

The mirror needs a trustworthy source of truth. If the data pipeline itself is TS-only, the rest of the website becomes much simpler to reason about and much harder to regress.

## Target State

### 1. Course Structure

The web app exposes the same teaching structure as upstream:

- bridge docs such as `s00*`, glossary/reference material, and late-stage bridge docs
- session chapters `s01` through `s19`
- reference, layers, compare, timeline, and per-doc routes
- localized navigation and chapter labels

### 2. Source Visibility Rules

The repository and site operate under these rules:

- If a chapter has a TS implementation, source viewer uses that TS file.
- No viewer, diff page, generated JSON payload, or page component should expose Python source text or Python filenames.
- Python may be read during sync work as a migration reference, but it must not remain in the repository or website output.

### 3. Chapter Status Model

Each mirrored upstream session chapter must be `implemented`, backed by a real TS source file.

Bridge docs and reference docs may exist without runnable code, but session chapters `s01` through `s19` may not be represented by placeholders.

### 4. Governance Rules

This mirror should formalize permanent sync rules in two places:

- root `AGENTS.md` for hard operational rules
- a detailed sync strategy document under `docs/` for audit flow, priorities, and acceptance criteria

These governance docs should make the sync contract stable so future updates do not require renegotiating the mirror policy.

## Architecture Changes

### A. Generated Metadata Contract

The generated version index should assume every visible session chapter has a TS source file.

It should support:

- chapter identity and ordering
- localized titles/subtitles/key insights
- required TS source payload for session chapters
- diff payload when adjacent TS sources exist

Bridge/reference docs remain document-only, but session chapter records must not fall back to placeholders.

### B. Extraction Pipeline

`web/scripts/extract-content.ts` should be refactored into a TS-only extractor that:

- reads all mirrored markdown docs and bridge docs
- reads all session TS agent files
- derives metadata for `s01-s19` from real TS source
- never scans or serializes Python files

### C. Web Rendering

The web UI should assume session source exists for mirrored chapters.

Pages that currently assume only the old 12-session TS set exists must be expanded for the full mirrored TS set:

- version page
- source viewer
- diff page
- compare page
- timeline and reference surfaces where source-derived details appear

The correct fallback for missing TS implementation is not placeholder UI. It is to complete the missing TS implementation before the sync is considered done.

### D. Repository Layout

For this phase, the repo should remove mirrored Python agent files that were pulled in during upstream sync.

The mirror should keep:

- upstream markdown/docs structure
- TypeScript runtime/source files
- web assets and generated data

The mirror should not keep:

- upstream Python agent source

It should also add governance docs that codify the long-term mirror policy.

## Implementation Phases

### Phase 1: Codify mirror governance

- Add root `AGENTS.md` with the TS mirror hard rules.
- Add a detailed sync strategy document under `docs/`.
- Update the design/spec set so future sync work follows these defaults automatically.

### Phase 2: Remove Python from the mirror surface

- Delete Python agent files added by upstream sync.
- Ensure no package/test/page imports rely on them.
- Confirm generated data no longer serializes Python filenames or source blobs.

### Phase 3: Strictly audit `s01-s12`

- Compare each existing TS chapter against the latest upstream chapter semantics.
- Update chapter titles, subtitles, key insights, docs, web metadata, and explanatory UI where they have drifted.
- Update TS implementation boundaries where the old code would misrepresent the chapter's current teaching mechanism.

### Phase 4: Translate `s13-s19` into TS

- Read upstream Python chapter implementations as migration inputs.
- Create matching TS session implementations for `s13-s19`.
- Ensure generated data, source viewer, compare, and diff all use TS outputs only.

### Phase 5: Align navigation and labels with upstream

- Keep route structure, timeline, layers, reference pages, and doc taxonomy aligned with upstream.
- Ensure locale strings cover the expanded course map.

### Phase 6: Continuous sync policy

- Future upstream session changes should trigger chapter-level TS implementation updates in the same sync task.
- Existing mirrored TS chapters should be re-audited when upstream semantics change.

## Testing Strategy

Add or update tests for:

- extractor output shape for the full TS chapter set
- generated metadata containing no `.py` filenames
- source viewer and compare behavior for all mirrored TS chapters
- docs/navigation smoke coverage for `s00-s19`
- static build success

## Risks

### Risk 1: Upstream structure and local TS source diverge

Mitigation:

- Treat each upstream chapter sync as incomplete until the corresponding TS chapter is updated.

### Risk 2: Components still assume source exists everywhere

Mitigation:

- Expand the source-aware UI to the full TS set and keep the extractor contract strict.

### Risk 3: Regenerated JSON gets overwritten by old assumptions

Mitigation:

- Move TS-only generation rules into the extractor itself, not post-processing.

### Risk 4: Existing `s01-s12` drift remains hidden while focusing on new chapters

Mitigation:

- Make `s01-s12` semantic audit an explicit phase before translating `s13-s19`.

## Acceptance Criteria

- The site exposes upstream-equivalent course/doc structure through `s19`.
- No Python source files remain in the mirrored repository teaching surface.
- No generated web payload contains Python filenames or Python source text.
- `s01-s12` are audited and updated where their course semantics drifted from upstream.
- `s13-s19` exist as real TS session implementations, not missing pages and not placeholders.
- Root `AGENTS.md` and a detailed sync strategy doc codify the long-term mirror rules.
- Root tests and static web build pass.
