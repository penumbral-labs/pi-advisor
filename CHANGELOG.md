# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- Support the `max` advisor effort when the selected model advertises it and hide unsupported effort levels.

### Changed

- Cancelling the effort picker now keeps the selected advisor and uses the model's default effort; cancelling the nudge
  picker keeps the current nudge setting.
- Unknown or model-unsupported persisted effort values are ignored with a warning during restore and labelled
  unsupported in the `/advisor` mappings panel.
- Hand-edited nudge overrides are labelled `custom` and are preserved when the nudge picker is cancelled.

### Fixed

- Allow OAuth-backed advisor models to complete through Pi's auth-aware runtime without requiring a literal API key.
- Retry a normal empty advisor response once with identical inputs before returning an empty-response failure.

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
