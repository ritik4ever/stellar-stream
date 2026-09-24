# Changelog

All notable changes to this project will be documented in this file. This file is managed by [release-please](https://github.com/googleapis/release-please).

## Pre-1.0.0 History

These milestones predate the automated release-please setup and are preserved for historical reference.

### 2026-04-27

- Split streams support in the Soroban contract, including parent/child stream linkage and `create_split_stream`.
- Contract tests covering split stream creation, child stream lookup, and per-substream claim/cancel behavior.

### 2026-04-26

- Stream pause and resume support in the contract.
- Contract test coverage for pause/resume behavior and vesting extension after a pause.
- JWT hardening and related contract test coverage improvements.

### 2026-03-27

- Initial backend API and frontend UI for the Stellar Stream application.

### 2026-03-26

- Global event history API at `GET /api/events`.
- Webhook retry queue support for delivery failures.

### 2026-02-26

- Webhook notifications with exponential backoff.

### 2026-02-24

- Stream event history system.

---

# 1.0.0 (2026-04-28)


### Bug Fixes

* Add integration tests for auth challenge-verify-token flow ([#231](https://github.com/godamongstmen897/stellar-stream/issues/231)) ([a75883d](https://github.com/godamongstmen897/stellar-stream/commit/a75883d7d311caf21f09b66ab4beebb14e365c14))
* Add integration tests for recipient streams validation ([#234](https://github.com/godamongstmen897/stellar-stream/issues/234)) ([e5475f0](https://github.com/godamongstmen897/stellar-stream/commit/e5475f008f816a66ba9645d9289fcda79d1b1b5c))
* Add unit tests for webhook triggerWebhook and dead letter handling ([#222](https://github.com/godamongstmen897/stellar-stream/issues/222)) ([a234a41](https://github.com/godamongstmen897/stellar-stream/commit/a234a410aa66b7475ff63b703dca65e4e15959e5))
* Add unit tests for webhookWorker retry backoff and dead letter promotion ([#223](https://github.com/godamongstmen897/stellar-stream/issues/223)) ([a3e772e](https://github.com/godamongstmen897/stellar-stream/commit/a3e772efd1ddf6bcbf51ef6aa8c280b2ddf56f9b))
* **backend:** update tsconfig to resolve vercel type errors ([9492800](https://github.com/godamongstmen897/stellar-stream/commit/9492800b91f06a0c13905e83ecded4adbc59f03f))
* **contracts:** cancel should refund unvested portion only, not total minus claimed ([46470fb](https://github.com/godamongstmen897/stellar-stream/commit/46470fbb26c587d9022ff511ac49233c9bcdaf3f))
* convert postcss.config.js to CommonJS to fix CI build ([cfe651a](https://github.com/godamongstmen897/stellar-stream/commit/cfe651a748c5c66e0362143481cf7c5c4d63dcd4))
* correct cancel logic for edge cases and expand test coverage ([b5dadb2](https://github.com/godamongstmen897/stellar-stream/commit/b5dadb2f8b537a5434f73c2895a37b7782ea49f2))
* Ensure atomic stream state updates and event recording using database transactions, and correct oldStartAt capture in `updateStreamStartAt`. ([ebd07ed](https://github.com/godamongstmen897/stellar-stream/commit/ebd07ed1a40886cb5435fcfb861e683729ecd70f))
* **frontend:** add vite-env.d.ts to resolve TypeScript error on import.meta.env ([1da596c](https://github.com/godamongstmen897/stellar-stream/commit/1da596cdd69eb04fb8ef2f6272bdae474cc95e2e))
* **frontend:** resolve TS error with vite-env.d.ts ([4b128e7](https://github.com/godamongstmen897/stellar-stream/commit/4b128e7ba32ddb54f39fb0215991366add752fec))
* **indexer:** complete soroban RPC circuit breaker and resolve compiler errors ([79b8004](https://github.com/godamongstmen897/stellar-stream/commit/79b80042bc69c497e335482a99e10eb51d0940d5))
* remove package.json ([d4a7400](https://github.com/godamongstmen897/stellar-stream/commit/d4a74001acdbfac3b09aedab0abe7f23ed8ec422))
* repair upstream merge damage to frontend and backend ([6ce1f14](https://github.com/godamongstmen897/stellar-stream/commit/6ce1f14cd15f341105a75839b031e167c65c3537))
* resolve merge conflicts and complete asset whitelist feature ([aa1b3c6](https://github.com/godamongstmen897/stellar-stream/commit/aa1b3c6e7bf4efcc987d6416049fa3feb3603ddd))
* restore frontend package-lock ([8e088eb](https://github.com/godamongstmen897/stellar-stream/commit/8e088ebd6c70e3dec8f780785a54808de7bfc073))
* update streamStore with Soroban version and resolve index.ts conflict ([1d6acb3](https://github.com/godamongstmen897/stellar-stream/commit/1d6acb3d8bf33fac9cfe513bdc9182d06c689475))


### Features

* **#151:** Validate query params on GET /api/streams/export.csv ([6fd9097](https://github.com/godamongstmen897/stellar-stream/commit/6fd90972ac96a0aaee2d009ed3249b476f10f42e)), closes [#151](https://github.com/godamongstmen897/stellar-stream/issues/151)
* **#155:** Add Stellar public key validation using StrKey.isValidEd25519PublicKey ([34c341f](https://github.com/godamongstmen897/stellar-stream/commit/34c341f296e8cb07c30e7cd14a2e25ceb87f83c7)), closes [#155](https://github.com/godamongstmen897/stellar-stream/issues/155)
* **#158:** Implement webhook retry queue with dead-letter storage ([e2796ad](https://github.com/godamongstmen897/stellar-stream/commit/e2796adfcd5c2c9aee2a386da4f97ca0e340add1)), closes [#158](https://github.com/godamongstmen897/stellar-stream/issues/158)
* **#161,#167,#168,#169:** add frontend hooks for toasts, websocket updates, and typed API errors ([7ec8b10](https://github.com/godamongstmen897/stellar-stream/commit/7ec8b106dbe93e1454aa7d27a2bd945ec6bdaf65)), closes [#161](https://github.com/godamongstmen897/stellar-stream/issues/161) [#167](https://github.com/godamongstmen897/stellar-stream/issues/167) [#168](https://github.com/godamongstmen897/stellar-stream/issues/168) [#169](https://github.com/godamongstmen897/stellar-stream/issues/169)
* add /api/allowed-assets endpoint and clean up index.ts ([95f9d29](https://github.com/godamongstmen897/stellar-stream/commit/95f9d298be877293479ab646451c994855cecb57))
* add asset whitelist config, backend validation & dynamic frontend dropdown ([#18](https://github.com/godamongstmen897/stellar-stream/issues/18)) ([a1fd599](https://github.com/godamongstmen897/stellar-stream/commit/a1fd59945d18ed134692034ea62e049e175e6b58))
* add background job to refresh stream statuses ([110f128](https://github.com/godamongstmen897/stellar-stream/commit/110f128a79353aa8ac17791812e9b8c8407659a2))
* add better-sqlite3 dependency for sqlite persistence ([0c478da](https://github.com/godamongstmen897/stellar-stream/commit/0c478da83dbd8bbd108ebf1403baad921b1ee5ff))
* add bulk filter presets for operations teams ([#51](https://github.com/godamongstmen897/stellar-stream/issues/51)) ([dea6718](https://github.com/godamongstmen897/stellar-stream/commit/dea67182d1ab46bc100533269576dc18fc7d3478))
* add comprehensive backend tests for auth-protected endpoints ([#76](https://github.com/godamongstmen897/stellar-stream/issues/76)) ([e96fa23](https://github.com/godamongstmen897/stellar-stream/commit/e96fa23ed406f2cf05dbc5e8100de88898bb094f))
* add contract client generation workflow for frontend ([#81](https://github.com/godamongstmen897/stellar-stream/issues/81)) ([04d9e41](https://github.com/godamongstmen897/stellar-stream/commit/04d9e419efa78a67e75bb934c330051771798247))
* add contract events for stream lifecycle operations ([2316865](https://github.com/godamongstmen897/stellar-stream/commit/231686566869206cf8374b6684daaaf9438a614d))
* add event-type filters to StreamTimeline ([679f0c1](https://github.com/godamongstmen897/stellar-stream/commit/679f0c11e1dab0df47d0d6f5af3669d40283f357))
* add Freighter wallet connect/disconnect ([#2](https://github.com/godamongstmen897/stellar-stream/issues/2)) ([4244cc4](https://github.com/godamongstmen897/stellar-stream/commit/4244cc47e0543a9cd4ec7790012ea784a5ceeb40))
* add GET /api/events for global event history ([#63](https://github.com/godamongstmen897/stellar-stream/issues/63)) ([a6d0b4b](https://github.com/godamongstmen897/stellar-stream/commit/a6d0b4bbab862211626d1211413fa61f47c13307))
* add global recent activity feed ([e136740](https://github.com/godamongstmen897/stellar-stream/commit/e13674053d8e769bc59e194bcc2b63992f3f3512))
* add JWT hardening, stream pause/resume, and contract test coverage improvements ([3957d9c](https://github.com/godamongstmen897/stellar-stream/commit/3957d9c57146dc3fb19dacdee6c163188fd60b94))
* add optional webhook signing ([77e845a](https://github.com/godamongstmen897/stellar-stream/commit/77e845a9b47b7768345d4d0010711cd6103fc6bd))
* Add pagination to getStreamHistory API endpoint ([07aeb6a](https://github.com/godamongstmen897/stellar-stream/commit/07aeb6a160f1d8bfd9a8cf91140c94ddee72cbf3)), closes [#143](https://github.com/godamongstmen897/stellar-stream/issues/143)
* add responsive chart section and empty state styles ([6022379](https://github.com/godamongstmen897/stellar-stream/commit/60223798b1bfe98abfbf655102cb70d7b038604b))
* add retry queue for webhook delivery failures ([#70](https://github.com/godamongstmen897/stellar-stream/issues/70)) ([1e9450e](https://github.com/godamongstmen897/stellar-stream/commit/1e9450ead8144c5fe9e459bcfc4b093f0aef3a02))
* add sender dashboard view with filtering and metrics ([1efd2b5](https://github.com/godamongstmen897/stellar-stream/commit/1efd2b526b3ba23269f255be7a171b95725a29cc))
* add shared zod validation for backend and frontend ([c6417a4](https://github.com/godamongstmen897/stellar-stream/commit/c6417a43aafb16ecc990c65da0b396a78dcdca32))
* add sqlite database initialization and migration layer ([281fe72](https://github.com/godamongstmen897/stellar-stream/commit/281fe72bd46d736790edb43e5c053fbae4eebcda))
* add startup config validation for Soroban environment ([#72](https://github.com/godamongstmen897/stellar-stream/issues/72)) ([dd3c6ef](https://github.com/godamongstmen897/stellar-stream/commit/dd3c6efb19aa12e89cf63ef9493d22f34162f212))
* add stream health badges in table ([#52](https://github.com/godamongstmen897/stellar-stream/issues/52)) ([b1f35f0](https://github.com/godamongstmen897/stellar-stream/commit/b1f35f0aecc008c8de7231bdda6c63ae77986caa))
* add StreamMetricsChart component with area chart and empty state ([6805449](https://github.com/godamongstmen897/stellar-stream/commit/68054494916d19a019d0d8d8335db8dd5bf53c7e))
* Add Swagger API documentation for backend routes ([9219d71](https://github.com/godamongstmen897/stellar-stream/commit/9219d710d3125e60dabec511397693c52cb559d1))
* add useFormValidation hook and update CreateStreamForm with whitelist dropdown ([62b9dca](https://github.com/godamongstmen897/stellar-stream/commit/62b9dca5898eea5b0025823c8f41039f7c251a20))
* add useMetricsHistory hook to track metrics snapshots over time ([926610f](https://github.com/godamongstmen897/stellar-stream/commit/926610f5e6b8dd6b5f04dc6a04f9e9c89ef8c8e2))
* **backend:** add request ID and structured logging middleware ([12921ff](https://github.com/godamongstmen897/stellar-stream/commit/12921ffb7ec39cef0b62c0761a71855f526df6e3))
* batch syncStreams, status refresh cron, refresh token, claim flow ([#136](https://github.com/godamongstmen897/stellar-stream/issues/136) [#138](https://github.com/godamongstmen897/stellar-stream/issues/138) [#140](https://github.com/godamongstmen897/stellar-stream/issues/140) [#49](https://github.com/godamongstmen897/stellar-stream/issues/49)) ([7bff88e](https://github.com/godamongstmen897/stellar-stream/commit/7bff88e6c06388bb60cc4121aaaec3675cb52bf1))
* **contract:** add stream metadata and compliance clawback ([#119](https://github.com/godamongstmen897/stellar-stream/issues/119) [#121](https://github.com/godamongstmen897/stellar-stream/issues/121)) ([e786bf7](https://github.com/godamongstmen897/stellar-stream/commit/e786bf7fa1c29cbc4ce98726fa37b925b00cfe86))
* expose asset allowlist endpoint ([d6efb5d](https://github.com/godamongstmen897/stellar-stream/commit/d6efb5d2f393f6dc366c4223c6133e7f39e69551))
* form draft autosave for stream creation ([#59](https://github.com/godamongstmen897/stellar-stream/issues/59)) ([4f6b4af](https://github.com/godamongstmen897/stellar-stream/commit/4f6b4af8f697ca32cddadf09c509a5a4ae2d8d47))
* implement asset whitelist - env config, backend validation, dynamic endpoint & frontend dropdown ([#18](https://github.com/godamongstmen897/stellar-stream/issues/18)) ([30fe446](https://github.com/godamongstmen897/stellar-stream/commit/30fe446801e8fc2fad09153979d8043287c6dbe1))
* implement initial backend API and frontend UI for Stellar Stream application. ([57e121e](https://github.com/godamongstmen897/stellar-stream/commit/57e121e464376e6a76a3cd7601f17d0163926243))
* implement query parsing and pagination for streams API ([44c5b20](https://github.com/godamongstmen897/stellar-stream/commit/44c5b203a1b2af296bc8fc76e983759292926475))
* Implement SEP-10 Auth ([b6c7fcc](https://github.com/godamongstmen897/stellar-stream/commit/b6c7fcc0168ecd17b4d71f319a2a3b46e7dc8596))
* implement stream event history system ([096e1af](https://github.com/godamongstmen897/stellar-stream/commit/096e1af2d4008bc98204a7fe653b6a8e96462e9f))
* Implement stream management with a new frontend table, backend API, validation, Swagger documentation, and tests. ([58c5355](https://github.com/godamongstmen897/stellar-stream/commit/58c53554e66c87e05ab23db166112dfd367898b6))
* implement webhook notifications with exponential backoff ([8bacaf1](https://github.com/godamongstmen897/stellar-stream/commit/8bacaf1a120dcd4e493442a2a513abfd1d254d80))
* integrate request logging middleware at server startup ([b2cd621](https://github.com/godamongstmen897/stellar-stream/commit/b2cd621f9477bde390d153cedef132642144c790))
* Integrate Soroban contract for stream management and add backend initialization for RPC and stream syncing. ([eed910b](https://github.com/godamongstmen897/stellar-stream/commit/eed910b2e3ba4a36cc19fae3a7930c5743cc20dc))
* integrate Soroban token client for real token transfer on claim ([9419d33](https://github.com/godamongstmen897/stellar-stream/commit/9419d337c1f8756a52c5c79903b687f75980f00a))
* integrate stream metrics chart and history tracking into dashboard ([f117835](https://github.com/godamongstmen897/stellar-stream/commit/f11783527a088dbbdc5901bcc0cca6b0349b005d))
* keyboard-accessible modal flow for start-time editing ([#57](https://github.com/godamongstmen897/stellar-stream/issues/57)) ([1cbf023](https://github.com/godamongstmen897/stellar-stream/commit/1cbf02340fa775a7180659b7f27c28dbbb97bb99))
* persist dashboard filters and view state in URL with stream timeline expand ([3a8c5cb](https://github.com/godamongstmen897/stellar-stream/commit/3a8c5cb4d77e39e4df64d22d1b14a82033583f42))
* persist indexer cursor in SQLite to handle restarts ([#68](https://github.com/godamongstmen897/stellar-stream/issues/68)) ([a9fd0d3](https://github.com/godamongstmen897/stellar-stream/commit/a9fd0d32340be86f7edc0d4de39bf64cfe98557d))
* replace in-memory stream store with sqlite persistence ([df825ad](https://github.com/godamongstmen897/stellar-stream/commit/df825ad62a678b095fdd2cd1401f47602dcbffb0))
* setup docker compose for local development ([e783c0d](https://github.com/godamongstmen897/stellar-stream/commit/e783c0dc8fcb5b304bb98ca410000739fc82a8d6))
* standardize request ID in all error responses ([550301c](https://github.com/godamongstmen897/stellar-stream/commit/550301c9a47c6eb06f8c75812ff9b006c1a9b715)), closes [#154](https://github.com/godamongstmen897/stellar-stream/issues/154)
* Standardize request ID in all error responses ([07a54b5](https://github.com/godamongstmen897/stellar-stream/commit/07a54b51cbff4ae399b6dbc259b2a643d740d487)), closes [#154](https://github.com/godamongstmen897/stellar-stream/issues/154)
* update test.rs ([5cc4d85](https://github.com/godamongstmen897/stellar-stream/commit/5cc4d85ecbdaa51874617e1e60cd3ca3afd486fd))
* **wave4:** add reliability, performance, and data accuracy improvements ([1bf095a](https://github.com/godamongstmen897/stellar-stream/commit/1bf095add9a803b15fe70c5019ce73d703abda5a)), closes [#133](https://github.com/godamongstmen897/stellar-stream/issues/133) [#132](https://github.com/godamongstmen897/stellar-stream/issues/132) [#134](https://github.com/godamongstmen897/stellar-stream/issues/134) [#137](https://github.com/godamongstmen897/stellar-stream/issues/137) [#133](https://github.com/godamongstmen897/stellar-stream/issues/133) [#132](https://github.com/godamongstmen897/stellar-stream/issues/132) [#134](https://github.com/godamongstmen897/stellar-stream/issues/134) [#137](https://github.com/godamongstmen897/stellar-stream/issues/137)
