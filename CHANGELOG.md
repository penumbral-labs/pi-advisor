# Changelog

All notable changes to this project are documented in this file.

## [0.2.0] - 2026-07-27

### Added

- Rebuilt the extension on focused config, lifecycle, compatibility, execution, context, inventory, registration, UI,
  and nudge modules derived from the upstream v2 architecture.
- Added auth-aware Pi runtime completion with a version-tolerant compatibility fallback.
- Added canonical session-context construction, bounded transcript curation, stage inference, executor signals, and
  preservation of compaction and branch summaries.
- Added structured advisor results and failure details, per-run usage limits, and LiteLLM adaptive-thinking
  normalization.
- Added configurable pre-execution, mutation-burst, and long-run nudges with per-executor presets, session backoff, and
  quiet paths.
- Added focused configuration and tool-reference documentation, package-content verification, and an isolated Pi loader
  smoke test with deterministic completion.

### Changed

- Preserved executor-specific advisor model and effort mappings as the control model, with immediate reconciliation when
  Pi switches primary models.
- Preserved the `~/.pi/agent/pi-advisor.json` `default` / `byExecutor` schema and colon-form model stubs.
- Updated consultation guidance to recommend the advisor only when independent judgment could materially change the
  approach.
- Config saves now report failures instead of displaying a success state after an unsuccessful write.

### Removed

- Removed the legacy monolithic implementation and duplicate transcript-curation module.
- Removed the static package-root `completeSimple` import in favor of Pi's runtime or compatibility APIs.
