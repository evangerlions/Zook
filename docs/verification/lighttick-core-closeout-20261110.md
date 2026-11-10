# LightTick core local closeout, 2026-11-10

Full progress stays **21/27**, release **HOLD**. No production API, OpenAPI or DDL change; no real data import, model call, dev/online or store deployment.

The existing core-matrix tools are extended with `--core-closeout`: dedicated loopback PostgreSQL `58681/joint_core_closeout_qa`, Redis `58686`, API `3127`, native `3126`, Web `3138`. Existing profiles keep their original ports/database guards. Learning controls expose old/current version state and explicit consent recovery; offline controls now clear both fixture outage states after an accepted lost response.

Runtime base is main `c1f23ffb`. Its reviewed admin document/other-App baseline changed in the provider-instances commit, but the risk catalog still contained the prior fixture-file digest. After reviewing that exact upstream diff and running the three non-LightTick schema/admin checks, only the catalog digest was aligned. All 227 risk tests, generated contracts and the 1041-file line gate pass; thresholds and golden content were not relaxed.

Actual browser/iOS/Android flows verify canonical lesson notes/answers, stale Web 409 with retained input and no cloud mutation, explicit rebase, publication isolation, separate position/completion and native revocation. Practice verifies Web creation, iOS accepted/lost-response/relaunch/original-request recovery, Android feedback on the same action, and an explicit Web review before creating one next action. An earlier erroneous fault-injection run remains in the logs and DB; the successful story uses a distinct action ID.

Native UI testing exposed a real empty-answer adoption bug on both platforms: adopting a new publication's empty saved-answer array hid all current question editors. Native candidates now preserve same-version answers by stable ID and append unanswered current questions; old-version answers are not reused. Regression tests fail before repair and pass afterward. Approved current UI is saved in isolated native candidate commits; original user files retain their hashes. iOS 223 unit executions/1 existing skip/0 failures, Android 174/0 failures and APK builds, Web 65/type/build pass.

The iPhone 16 Plus independent QA application builds, installs and launches. Two XCTest attempts execute **zero test cases** because automation mode initialization times out. This is not physical cloud/VoiceOver acceptance. Android physical/TalkBack, minimum OS/actual supported old packages, full V4.5 recovery, target-resource other-App checks, observation and publication remain open.

Full report, immutable snapshots, exact source/binary hashes and verifier are maintained in plan:

- [Plan report](../../../plan/docs/04-planning/grow-lighttick-remaining-2026-11-08/core-closeout-verification.md)
- [Machine index](../../../plan/docs/04-planning/grow-lighttick-remaining-2026-11-08/core-closeout-evidence/verification.json)

Raw local fixtures/logs/xcresult/dumps remain in `plan/.artifacts/core-closeout-20261110`. Device identifiers, signing metadata and container data are excluded from copied evidence. Core UI roots use synthetic owner injection; they do not stand in for normal-login or full candidate release gates. The user selected current UI and iPhone QA; neither selection substitutes for completed verification.
