# Klear-0. Offline targets need no keys or network; testnet targets read .env and .secrets/.
#   make test       Rust judge tests + Foundry SIMULATION tests + simulated end-to-end loop
#   make live-read  read-only check of KeelLeg's read path against live HyperEVM testnet
#   make keys       create the testnet NEAR account and EVM relayer key (prints addresses only)
#   make status     what is funded and deployed, and what is still missing
#   make judge      the NEAR judge contract (contracts/near-keel, cargo-near) and its unit tests
#   make factory    the NEAR factory (contracts/near-keel-factory), which embeds the judge just built
#   make replay     Alpha Arena's AI agents' real history through Klear's rules (cached; `replay-fetch` refreshes)
#   make web        sync the site's data from docs/results, then build it; `web-test` runs its unit and browser tests
#   make drill      one cycle of the daily drill on the practice strategy (testnet; ~1 h); `drill-install` schedules it
#   make rescue ACCOUNT=you.testnet   rescue the practice strategy yourself when it is due (docs/practice.md)
# The real-network steps are in docs/testnet-runbook.md and scripts/testnet/g7.sh.

SHELL := /bin/bash
.PHONY: test rust evm e2e build judge judge-test factory factory-test privacy-test live-read keys status replay replay-fetch web web-test release drill drill-install rescue

test: rust evm e2e judge-test factory-test privacy-test

judge:
	cd contracts/near-keel && ../../node_modules/.bin/cargo-near near build non-reproducible-wasm
	shasum -a 256 contracts/near-keel/target/near/near_keel.wasm

judge-test:
	cd contracts/near-keel && cargo test -q

factory: judge
	cd contracts/near-keel-factory && ../../node_modules/.bin/cargo-near near build non-reproducible-wasm
	shasum -a 256 contracts/near-keel-factory/target/near/near_keel_factory.wasm

factory-test: judge
	cd contracts/near-keel-factory && cargo test -q

# klear-tee (sealed decisions verified on NEAR) and klear-owner (the confidential mandate's locked owner).
privacy-test:
	cd contracts/klear-tee && cargo test -q
	cd contracts/klear-owner && cargo test -q

build:
	cargo build -q -p keel-core
	cd contracts/evm && forge build

rust:
	cargo test -q

evm:
	cd contracts/evm && forge test

# Single-threaded: parallel ffi launches of a just-rebuilt judge binary intermittently exit 69 on
# macOS (seen 2 of 3 runs after a rebuild; 0 of 4 with one thread).
e2e: build
	cd contracts/evm && KEEL_E2E=1 forge test --ffi --threads 1 --match-path 'test/e2e/*'

live-read: build
	python3 -I scripts/live/read.py

keys:
	bash scripts/keys/new.sh

status:
	bash scripts/testnet/keel0.sh status

replay-fetch:
	.tools/venv/bin/python -I scripts/replay/fetch.py

replay:
	cargo run -q -p keel-replay --release

drill:
	.tools/venv/bin/python -u agents/drill.py --grace $${GRACE:-0}

drill-install:
	scripts/drill/launchd.sh install

rescue:
	test -x node_modules/.bin/near || npm ci
	test -x .tools/rescue/bin/python || (python3 -m venv .tools/rescue && .tools/rescue/bin/pip install -q certifi==2026.10.23)
	.tools/rescue/bin/python agents/rescue.py --account $(ACCOUNT) --wait

web:
	cd web && npm ci && npm run sync-data && npm run build

web-test: web
	cd web && npm run lint && npm run typecheck && npm test && npx playwright test

# The release artifacts locally, as .github/workflows/release.yml builds them (dist/, with SHA256SUMS).
release: factory
	cargo build -q --locked --release -p keel-core --bin keel-judge -p keel-replay
	cd contracts/evm && forge build
	rm -rf dist && mkdir -p dist/evm
	tar -czf dist/keel-$$(uname -m)-$$(uname -s | tr A-Z a-z).tar.gz -C target/release keel-judge keel-replay
	cp contracts/near-keel/target/near/near_keel.wasm dist/near_keel.wasm
	cp contracts/near-keel-factory/target/near/near_keel_factory.wasm dist/near_keel_factory.wasm
	for c in KeelLeg KeelVault KeelDeployer BalanceProbe; do cp contracts/evm/out/$$c.sol/$$c.json dist/evm/$$c.json; done
	tar -czf dist/keel-evm.tar.gz -C dist evm && rm -r dist/evm
	cp docs/results/replay/summary.json dist/alpha-arena-replay.json
	cd dist && shasum -a 256 * > SHA256SUMS && cat SHA256SUMS
