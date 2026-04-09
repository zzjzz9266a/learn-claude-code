# TypeScript Mirror Course Sync Design

## Goal

Make this repository a TypeScript mirror of the upstream course structure and website experience.

Success means:

- The chapter map, numbering, ordering, bridge docs, navigation, and generated web content match upstream's current teaching structure.
- The repository and website do not retain or display Python source.
- Existing TypeScript runnable chapters continue to work.
- Later chapters that do not yet have TypeScript implementations are represented as TypeScript-only placeholders rather than Python fallbacks.

## Non-Goals

- Fully implementing runnable TypeScript agents for `s13` through `s19` in this phase.
- Preserving upstream Python files for reference, diffing, or source viewing.
- Reproducing upstream internals 1:1 when they conflict with the TypeScript-only mirror goal.

## Constraints

- No Python source files should remain in the mirrored teaching surface.
- No page should render Python code snippets from generated data.
- The site must keep building as a static export.
- The existing `s01` through `s12` TypeScript runnable flow must remain valid.

## Recommended Approach

### Option A: Strict TS-Only Data Pipeline

Regenerate all teaching metadata from TypeScript source plus markdown docs only. For chapters without TS source, emit structured "implementation pending" records.

Pros:

- Cleanest long-term architecture.
- Eliminates Python leakage at the source.
- Keeps web components honest about what exists.

Cons:

- Requires changes to the extraction pipeline and some viewer assumptions.

### Option B: Hybrid Generated Data with Post-Filter

Keep upstream-shaped generated data, then strip Python-backed records at render time.

Pros:

- Faster to patch initially.

Cons:

- Fragile.
- Easy to leak Python into new pages or metadata.
- Creates persistent mismatch between data truth and UI truth.

### Option C: Hardcoded Mirror Metadata

Manually maintain chapter metadata, page structure, and placeholder states in static TS files, independent of extraction.

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
- If a chapter does not yet have a TS implementation, the site shows a TS-only placeholder state.
- No viewer, diff page, generated JSON payload, or page component should expose Python source text or Python filenames.

### 3. Chapter Status Model

Each chapter should resolve to one of:

- `implemented`: backed by a real TS source file
- `planned`: chapter exists in docs/site structure but TS source is not implemented yet

The site should render both states cleanly, but only `implemented` chapters get real source/diff content.

## Architecture Changes

### A. Generated Metadata Contract

The generated version index should stop assuming "every visible chapter has a concrete source file."

It should instead support:

- chapter identity and ordering
- localized titles/subtitles/key insights
- chapter status (`implemented` or `planned`)
- optional source payload
- optional diff payload only when both adjacent TS sources exist

This lets the site mirror upstream structure without inventing fake TS code.

### B. Extraction Pipeline

`web/scripts/extract-content.ts` should be refactored into a TS-only extractor that:

- reads all mirrored markdown docs and bridge docs
- reads implemented TS agent files
- derives metadata for `s01-s12` from real TS source
- emits placeholder records for `s13-s19` when source files are absent
- never scans or serializes Python files

### C. Web Rendering

The web UI should distinguish between chapter content and chapter implementation state.

Pages that currently assume source always exists must handle planned chapters explicitly:

- version page
- source viewer
- diff page
- compare page
- timeline and reference surfaces where source-derived details appear

Planned chapters should still be navigable, documented, and localized, but source sections should render a neutral TS-roadmap state instead of broken or fake code blocks.

### D. Repository Layout

For this phase, the repo should remove mirrored Python agent files that were pulled in during upstream sync.

The mirror should keep:

- upstream markdown/docs structure
- TypeScript runtime/source files
- web assets and generated data

The mirror should not keep:

- upstream Python agent source

## Implementation Phases

### Phase 1: Remove Python from the mirror surface

- Delete Python agent files added by upstream sync.
- Ensure no package/test/page imports rely on them.
- Confirm generated data no longer serializes Python filenames or source blobs.

### Phase 2: Make metadata support planned TS chapters

- Extend generated version records with chapter implementation status.
- Represent `s13-s19` as planned TS chapters.
- Keep `s01-s12` fully source-backed.

### Phase 3: Update page behavior for planned chapters

- Render docs normally for all chapters.
- Render source viewer placeholders for planned chapters.
- Suppress or degrade diff/compare features gracefully where a TS source pair does not exist.

### Phase 4: Align navigation and labels with upstream

- Keep route structure, timeline, layers, reference pages, and doc taxonomy aligned with upstream.
- Ensure locale strings cover the expanded course map.

### Phase 5: Future TS implementation expansion

- Add real TS implementations for `s13-s19`.
- Promote each chapter from `planned` to `implemented` as code lands.

## Testing Strategy

Add or update tests for:

- extractor output shape with implemented and planned chapters
- generated metadata containing no `.py` filenames
- source viewer planned-state rendering
- diff/compare behavior when source is unavailable
- docs/navigation smoke coverage for `s00-s19`
- static build success

## Risks

### Risk 1: Upstream structure and local TS source diverge

Mitigation:

- Make chapter status explicit instead of pretending parity in source coverage.

### Risk 2: Components still assume source exists everywhere

Mitigation:

- Add one shared source-availability helper and route all source-aware UI through it.

### Risk 3: Regenerated JSON gets overwritten by old assumptions

Mitigation:

- Move status-aware generation into the extractor itself, not post-processing.

## Acceptance Criteria

- The site exposes upstream-equivalent course/doc structure through `s19`.
- No Python source files remain in the mirrored repository teaching surface.
- No generated web payload contains Python filenames or Python source text.
- `s01-s12` keep real TS source viewing.
- `s13-s19` render as valid TS-only planned chapters, not missing pages and not Python fallbacks.
- Root tests and static web build pass.
