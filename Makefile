SWIFT_PKG := Packages/BuilderKit

.PHONY: help gen icons lint check-gen build test scan watch doctor share clean measure measure-gaps analyze fixtures capture-test

help:
	@echo "gen        regenerate everything from privacy/, spec/ and design/"
	@echo "icons      re-render the store icons from the mascot frame and design/tokens.json"
	@echo "lint       the server lint EXACTLY as CI runs it (pinned ruff)"
	@echo "check-gen  regenerate and fail if anything changed (this is the CI gate)"
	@echo "build      swift build"
	@echo "test       swift test — the ground-truth regression suite"
	@echo "scan       parse everything on disk into the local store"
	@echo "watch      run the daemon: watch, sessionize, notify on completion"
	@echo "doctor     diagnostics, per-source row counts, records, rollups"
	@echo "measure    what the session-boundary rules do to ~/.claude/projects (read-only)"
	@echo "measure-gaps  the gap distribution, the two-mode fit and the fitted tau for YOUR corpus"
	@echo "analyze    T=<transcript.jsonl>  digest it and have your own Claude Code read it"
	@echo "fixtures   regenerate spec/fixtures/boundaries from the reference implementation"
	@echo "capture-test  the cloud uploader: boundary parity, contract conformance, refresh-on-401"

# The specs are the only hand-edited definitions of the wire payload, the strip format,
# the palette, the session analysis, the report and the live state. Everything downstream
# is generated into Swift, TypeScript and Python so the same numbers cannot drift across
# three languages.
#
# Order (docs/overnight-integration.md section 6): contract, strip, tokens, analysis,
# narrative, shipped, report, live, drops, devices, shipkit, copy, live_fixtures, fixtures.
# gen_shipkit reads spec/devices.v1.json (its formats are the device table's), so it runs after
# gen_devices; neither reads anything a later generator writes. gen_contract reads
# spec/live.v1.json only for its leaf paths, so it may run first; gen_copy and
# gen_live_fixtures read the analysis modules, so they run after every spec.
#
# gen_copy.py belongs to report v2 (WP-B) and is run once it exists: before that there is no
# copy.ts to be stale. gen_live_fixtures.py says which of its inputs is missing and writes
# nothing until all of them exist.
gen:
	@python3 scripts/gen_contract.py
	@python3 scripts/gen_strip.py
	@python3 scripts/gen_tokens.py
	@python3 scripts/gen_mac_creatures.py
	@python3 scripts/gen_harness_logos.py
	@python3 scripts/gen_analysis.py
	@python3 scripts/gen_narrative.py
	@python3 scripts/gen_shipped.py
	@python3 scripts/gen_report.py
	@python3 scripts/gen_live.py
	@python3 scripts/gen_drops.py
	@python3 scripts/gen_devices.py
	@python3 scripts/gen_shipkit.py
	@if [ -f scripts/gen_copy.py ]; then python3 scripts/gen_copy.py; else echo "gen_copy.py: not written yet, nothing to generate"; fi
	@python3 scripts/gen_stack_logos.py
	@python3 scripts/gen_live_fixtures.py
	@python3 scripts/gen_fixtures.py

# The exact command the backend job runs, with the version CI pins. Three pushes went red
# on an import-sort finding nobody had run locally, which is the cheapest possible way to
# waste a CI cycle. `ruff format --check` drifts between releases, so the version is part
# of the gate.
lint:
	@uvx ruff@0.16.6 check server && uvx ruff@0.16.6 format --check server

# NOT part of `make gen`, and deliberately not a CI gate: a zlib-compressed PNG is not
# guaranteed byte-identical across zlib builds, so `git diff --exit-code` on one would
# fail a healthy runner. Run it when the accent or the mascot's resting pose changes.
icons:
	@python3 scripts/gen_app_icons.py

# Fastest gate in CI, so it runs first. If this fails, someone hand-edited a generated
# file — including, potentially, a generated file that defines what may leave the machine.
check-gen: gen
	@git diff --exit-code -- \
		Packages/BuilderKit/Sources/BuilderModel/Generated \
		Packages/BuilderKit/Sources/BuilderSync/Generated \
		mobile/src/generated server/builder/contract.py server/builder/strip.py \
		drops/tables.py drops/schema.json \
		capture/demo/devices_table.py capture/shipkit/tables.py capture/shipkit/copy_schema.json \
		server/builder/shipkit_spec.py \
		server/builder/analysis_spec.py server/builder/report_spec.py \
		server/builder/narrative_spec.py server/builder/shipped_spec.py \
		server/builder/live_spec.py server/builder/quotes_spec.py server/builder/media_spec.py analysis \
		Packages/BuilderKit/Sources/BuilderAnalysis/Resources/analysis_schema.json \
		server/builder/static/upload-fields.json PRIVACY.md spec/fixtures \
		mobile/targets/widget/_shared/Palette.swift mobile/targets/widget/_shared/HarnessMarks.swift \
		mobile/src/pixel/harnessLogos.ts mobile/src/stack/stackLogos.ts \
		|| (echo ""; echo "FAIL: generated files are stale or hand-edited. Run 'make gen' and commit."; exit 1)
	@echo "generated files match their specs"

build:
	swift build --package-path $(SWIFT_PKG)

test:
	swift test --package-path $(SWIFT_PKG)

scan:
	swift run --package-path $(SWIFT_PKG) builder scan

watch:
	swift run --package-path $(SWIFT_PKG) builder watch

doctor:
	swift run --package-path $(SWIFT_PKG) builder doctor

share:
	swift run --package-path $(SWIFT_PKG) builder share --last

clean:
	swift package --package-path $(SWIFT_PKG) clean

# Read-only: presence-interval distribution and the sensitivity grid for the two boundary
# thresholds that ship as judgement calls (docs/session-boundaries.md). Run it on your own
# corpus before changing either number.
measure:
	@python3 scripts/measure_boundaries.py $${ROOT:-$$HOME/.claude/projects}

# Read-only: the inter-event gap histogram, the naive record-gap fit (which finds the
# harness's write cadence) and the v3 fit on human presence intervals (which is what the
# sessionizer uses), with the session count at the fitted tau against the 900 s fallback.
# Pass EXTRA=<dir> for a tree of other harnesses' transcripts; SYNTHETIC=<dir> to also run
# the boundary fixtures, labelled as such.
measure-gaps:
	@python3 scripts/measure_gap_distribution.py --root $${ROOT:-$$HOME/.claude/projects} \
		$${EXTRA:+--extra $$EXTRA} $${SYNTHETIC:+--synthetic $$SYNTHETIC}

# One session, end to end: digest -> claude -p -> validated SessionAnalysis JSON.
analyze:
	@test -n "$(T)" || (echo "usage: make analyze T=path/to/transcript.jsonl"; exit 2)
	@python3 -m analysis run "$(T)" --out "$${OUT:-analysis.json}"

fixtures:
	@python3 scripts/gen_boundary_fixtures.py
	@python3 scripts/gen_real_fixture_expected.py

# `capture/` is the uploader for Claude Code sessions that run in the cloud
# (docs/cloud-capture.md). Stdlib unittest: it must run where nothing is installed.
capture-test:
	@python3 -m unittest discover -s capture/tests -t . -v
