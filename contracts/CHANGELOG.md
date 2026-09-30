# Changelog

## [0.2.0](https://github.com/ritik4ever/stellar-stream/compare/contracts-v0.1.0...contracts-v0.2.0) (2026-09-30)


### Features

* Add get_stream_count view and expose onChainStreamCount via /api/stats ([45e7c3f](https://github.com/ritik4ever/stellar-stream/commit/45e7c3fc5431b0600f8cb9f575af03703b03d752))
* Add SAC validation, stream metadata, and indexer events for paused/resumed/transfer ([70724e5](https://github.com/ritik4ever/stellar-stream/commit/70724e51f47974bbf83bf15b23c9cce4abc21959))
* **contracts:** Add DAO governance scaffold ([#695](https://github.com/ritik4ever/stellar-stream/issues/695)) ([015b5b5](https://github.com/ritik4ever/stellar-stream/commit/015b5b5495880077c171b9b2b3e8ef2d1d9a869e))
* **contracts:** Add multi-token allowlist support ([#593](https://github.com/ritik4ever/stellar-stream/issues/593)) ([2aa9fe6](https://github.com/ritik4ever/stellar-stream/commit/2aa9fe6d39064a5be91a944e0c30e75847dd6315))
* **contracts:** Add structured event schema with actor+timestamp ([a3f582c](https://github.com/ritik4ever/stellar-stream/commit/a3f582cf5e2b01001c5ffa7ae2e09a8606b70908))
* **contracts:** Document upgrade compatibility guarantees ([#1292](https://github.com/ritik4ever/stellar-stream/issues/1292)) ([c5fac56](https://github.com/ritik4ever/stellar-stream/commit/c5fac56f51f819207e193d7dafd77d32e66d0300))
* **contracts:** Document upgrade compatibility guarantees ([#1293](https://github.com/ritik4ever/stellar-stream/issues/1293)) ([6c64796](https://github.com/ritik4ever/stellar-stream/commit/6c64796c806e5c3b1bef7b20ca77eae6d72274b1))
* **contracts:** Rate-limit claims with min_claim_interval_seconds ([#681](https://github.com/ritik4ever/stellar-stream/issues/681)) ([5085521](https://github.com/ritik4ever/stellar-stream/commit/5085521aac35606fb8004da78fdf18466fe2f0d0))
* Resolve issues [#328](https://github.com/ritik4ever/stellar-stream/issues/328), [#329](https://github.com/ritik4ever/stellar-stream/issues/329), [#331](https://github.com/ritik4ever/stellar-stream/issues/331), [#334](https://github.com/ritik4ever/stellar-stream/issues/334) — cliff support, split stream UI, metadata display, lifecycle test ([66a9ef3](https://github.com/ritik4ever/stellar-stream/commit/66a9ef32751a946ac6f5e0dc6bde48abea1abc20))
* Support streaming native XLM alongside SEP-41 tokens ([#120](https://github.com/ritik4ever/stellar-stream/issues/120)) ([a96ec54](https://github.com/ritik4ever/stellar-stream/commit/a96ec5436f62ff58a16d1b5bb25f0cbacff528bc))


### Bug Fixes

* [CONTRACT] Specify edge behavior for Contract upgrade compat ([#1179](https://github.com/ritik4ever/stellar-stream/issues/1179)) ([#1281](https://github.com/ritik4ever/stellar-stream/issues/1281)) ([70bd3f9](https://github.com/ritik4ever/stellar-stream/commit/70bd3f9e9413e1daf0fbb587889a53596da9b593))
* **contract:** Handle native sentinel in create_split_stream ([#120](https://github.com/ritik4ever/stellar-stream/issues/120)) ([e00be7b](https://github.com/ritik4ever/stellar-stream/commit/e00be7b62138bc2a4cd1dc713623339de14b0235))
* Implement issues [#214](https://github.com/ritik4ever/stellar-stream/issues/214), [#213](https://github.com/ritik4ever/stellar-stream/issues/213), [#218](https://github.com/ritik4ever/stellar-stream/issues/218), [#220](https://github.com/ritik4ever/stellar-stream/issues/220) ([fbcfd63](https://github.com/ritik4ever/stellar-stream/commit/fbcfd63f13398ade3f5ec045efcbfb4fa8ca2ce1))
* Native-token address getter/setter, contract fuzz tests, two compile blockers ([#688](https://github.com/ritik4ever/stellar-stream/issues/688) [#697](https://github.com/ritik4ever/stellar-stream/issues/697)) ([db89944](https://github.com/ritik4ever/stellar-stream/commit/db8994476c0419b5eef1043b4249e1c45fbcbbf3))
* Resolve merge conflicts with upstream/main ([5c61e09](https://github.com/ritik4ever/stellar-stream/commit/5c61e092e1a1190d14b8dc5be449d799efb3c02c))


### Documentation

* Add Soroban contract development quick-start guide (closes [#272](https://github.com/ritik4ever/stellar-stream/issues/272)) ([83b3823](https://github.com/ritik4ever/stellar-stream/commit/83b3823dd7d43079d4f5913469d22b454f0cf09e))
* Document contract storage layout and migrations ([ac1855a](https://github.com/ritik4ever/stellar-stream/commit/ac1855a08f4d83055115f2117a0b099e892b66aa))


### Tests

* Add contract unit tests for all stream state transitions ([#594](https://github.com/ritik4ever/stellar-stream/issues/594)) ([7be8075](https://github.com/ritik4ever/stellar-stream/commit/7be8075dd558de1a378a74efab917a511c5ebb10))
* Add test for cancel refund amount after partial claim ([3b3e1b7](https://github.com/ritik4ever/stellar-stream/commit/3b3e1b75b47ba5fd5e7f8964045b606a4f3e22f3))
* **contracts:** Add get_split_children empty Vec tests ([#212](https://github.com/ritik4ever/stellar-stream/issues/212)) ([b659beb](https://github.com/ritik4ever/stellar-stream/commit/b659bebe65316857b8ff2704cb0f2a8a69d964da))
* **contracts:** Verify authority over stream state from a previous build ([#1181](https://github.com/ritik4ever/stellar-stream/issues/1181)) ([#1290](https://github.com/ritik4ever/stellar-stream/issues/1290)) ([a413675](https://github.com/ritik4ever/stellar-stream/commit/a413675b20d9542c3d70c27073f530abba7749c0))
* Expand and update stream contract test snapshots to include new features and state validations ([4ba8127](https://github.com/ritik4ever/stellar-stream/commit/4ba8127463c43b5840b26ccb33779758748cbd92))
* **frontend:** Add SenderDashboard test coverage and resolve merge conflicts ([2e9cd1a](https://github.com/ritik4ever/stellar-stream/commit/2e9cd1a0abcb7e89e5788b6f7ac111b2d1b04f23))
