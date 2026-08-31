# OpenClaw Plugin Compatibility Report

Generated: deterministic
Status: PASS

## Summary

| Metric                     | Value |
| -------------------------- | ----- |
| Fixtures                   | 1     |
| High-priority fixtures     | 1     |
| Hard breakages             | 0     |
| Warnings                   | 1     |
| Compatibility suggestions  | 0     |
| Issue findings             | 1     |
| Open issue findings        | 1     |
| Runtime-covered findings   | 0     |
| Runtime-partial findings   | 0     |
| P0 issues                  | 0     |
| P1 issues                  | 0     |
| Open P0 issues             | 0     |
| Open P1 issues             | 0     |
| Live issues                | 0     |
| Live P0 issues             | 0     |
| Compat gaps                | 0     |
| Deprecation warnings       | 1     |
| Inspector gaps             | 0     |
| Open inspector gaps        | 0     |
| Runtime coverage artifacts | 0     |
| Upstream metadata          | 0     |
| Contract probes            | 0     |
| Decision rows              | 0     |

## Triage Overview

| Class               | Count | P0 | Meaning                                                                                                                                                  |
| ------------------- | ----- | -- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| live-issue          | 0     | 0  | Potential runtime breakage in the target OpenClaw/plugin pair. P0 only when it is not a deprecated compat seam.                                          |
| compat-gap          | 0     | -  | Compatibility behavior is needed but missing from the target OpenClaw compat registry.                                                                   |
| deprecation-warning | 1     | -  | Plugin uses a supported but deprecated compatibility seam; keep it wired while migration exists.                                                         |
| inspector-gap       | 0     | -  | Plugin Inspector needs stronger capture/probe evidence before making contract judgments. Runtime-covered rows are proof-backed and not open report work. |
| upstream-metadata   | 0     | -  | Plugin package or manifest metadata should improve upstream; not a target OpenClaw live break by itself.                                                 |
| fixture-regression  | 0     | -  | Fixture no longer exposes an expected seam; investigate fixture pin or scanner drift.                                                                    |

## P0 Live Issues

_none_

## Other Live Issues

_none_

## Compat Gaps

_none_

## Deprecation Warnings

- P2 **openclaw-lark-2** `deprecation-warning` `core-compat-adapter`
  - **sdk-load-session-store**: openclaw-lark-2: deprecated whole-store session helper is still used
  - state: open · compat:none
  - evidence:
    - openclaw/plugin-sdk/session-store-runtime loadSessionStore import @ dist/monitor-cA4vnpyd.mjs:29
    - openclaw/plugin-sdk/session-store-runtime loadSessionStore import @ src/card/tool-use-config.ts:14
  - author remediation:
    - Replace deprecated loadSessionStore whole-store access with row-scoped session helpers.
    - docs: https://docs.openclaw.ai/clawhub/plugin-validation-fixes#sdk-load-session-store

## Inspector Proof Gaps

_none_

## Runtime-Covered Inspector Gaps

_none_

## Upstream Metadata Issues

_none_

## Hard Breakages

_none_

## Target OpenClaw Compat Records

| Metric                    | Value                                      |
| ------------------------- | ------------------------------------------ |
| Configured path           | npm:openclaw@2026.8.1                      |
| Status                    | ok                                         |
| Requested version         | 2026.8.1                                   |
| Resolved version          | 2026.8.1                                   |
| Range eligibility version | 2026.8.1                                   |
| Source                    | npm:openclaw                               |
| NPM dist-tag              | -                                          |
| Prepared cache            | hit                                        |
| Compat registry           | -                                          |
| Compat records            | 0                                          |
| Compat status counts      | -                                          |
| Record ids                | -                                          |
| Hook registry             | dist/acpx-BnI94i_U.d.ts                    |
| Hook names                | 42                                         |
| API builder               | dist/acpx-BnI94i_U.d.ts                    |
| API registrars            | 57                                         |
| Captured registration     | dist/acpx-BnI94i_U.d.ts                    |
| Captured registrars       | 57                                         |
| Package metadata          | package.json                               |
| Plugin SDK exports        | 321                                        |
| Manifest types            | dist/manifest-registry.types-BA6Tiq51.d.ts |
| Manifest fields           | 71                                         |
| Manifest contract fields  | 22                                         |

## Warnings

| Fixture         | Code                   | Level   | Message                                                                                                                                                                                    | Evidence                                                                                                                                                                                             | Compat record |
| --------------- | ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| openclaw-lark-2 | sdk-load-session-store | warning | loadSessionStore keeps the legacy whole-store session shape; use getSessionEntry(...) / listSessionEntries(...) for reads and patchSessionEntry(...) / upsertSessionEntry(...) for writes. | openclaw/plugin-sdk/session-store-runtime loadSessionStore import @ dist/monitor-cA4vnpyd.mjs:29, openclaw/plugin-sdk/session-store-runtime loadSessionStore import @ src/card/tool-use-config.ts:14 | -             |

## Suggestions To OpenClaw Compat Layer

_none_

## Issue Findings

- P2 **openclaw-lark-2** `deprecation-warning` `core-compat-adapter`
  - **sdk-load-session-store**: openclaw-lark-2: deprecated whole-store session helper is still used
  - state: open · compat:none
  - evidence:
    - openclaw/plugin-sdk/session-store-runtime loadSessionStore import @ dist/monitor-cA4vnpyd.mjs:29
    - openclaw/plugin-sdk/session-store-runtime loadSessionStore import @ src/card/tool-use-config.ts:14
  - author remediation:
    - Replace deprecated loadSessionStore whole-store access with row-scoped session helpers.
    - docs: https://docs.openclaw.ai/clawhub/plugin-validation-fixes#sdk-load-session-store

## Contract Probe Backlog

_none_

## Fixture Seam Inventory

| Fixture         | Priority | Seams        | Hooks                             | Registrations                                               | Manifest contracts |
| --------------- | -------- | ------------ | --------------------------------- | ----------------------------------------------------------- | ------------------ |
| openclaw-lark-2 | high     | dynamic-tool | after_tool_call, before_tool_call | registerChannel, registerCli, registerCommand, registerTool | tools              |

## Decision Matrix

_none_

## Raw Logs

| Fixture         | Code                    | Level | Message                                                                               | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Compat record |
| --------------- | ----------------------- | ----- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| openclaw-lark-2 | seam-inventory          | log   | observed 2 hooks, 4 registrations, and 1 manifest contracts                           | hook:after_tool_call, hook:before_tool_call, registration:registerChannel, registration:registerCli, registration:registerCommand, registration:registerTool, manifestContract:tools                                                                                                                                                                                                                                                                                                                                                                                                                                                         | -             |
| openclaw-lark-2 | hook-names-present      | log   | all observed hooks exist in the target OpenClaw hook registry                         | after_tool_call, before_tool_call                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | -             |
| openclaw-lark-2 | api-registrars-present  | log   | all observed api.register* calls exist in the target OpenClaw plugin API builder      | registerChannel, registerCli, registerCommand, registerTool                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -             |
| openclaw-lark-2 | sdk-exports-present     | log   | all observed plugin SDK imports exist in target OpenClaw package exports              | openclaw/plugin-sdk/account-id, openclaw/plugin-sdk/agent-runtime, openclaw/plugin-sdk/allow-from, openclaw/plugin-sdk/channel-feedback, openclaw/plugin-sdk/channel-message, openclaw/plugin-sdk/channel-secret-basic-runtime, openclaw/plugin-sdk/channel-status, openclaw/plugin-sdk/command-auth, openclaw/plugin-sdk/core, openclaw/plugin-sdk/param-readers, openclaw/plugin-sdk/plugin-runtime, openclaw/plugin-sdk/reply-history, openclaw/plugin-sdk/reply-runtime, openclaw/plugin-sdk/routing, openclaw/plugin-sdk/session-store-runtime, openclaw/plugin-sdk/setup, openclaw/plugin-sdk/temp-path, openclaw/plugin-sdk/tool-send | -             |
| openclaw-lark-2 | manifest-fields-checked | log   | plugin manifest fields were compared with target OpenClaw manifest types              | openclaw.plugin.json                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | -             |
| openclaw-lark-2 | package-metadata        | log   | selected package metadata for plugin contract checks                                  | package.json, @mirr0ch1/openclaw-lark-2, version:2026.8.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | -             |
| openclaw-lark-2 | declarative-contracts   | log   | fixture declares manifest contracts that can be checked without executing plugin code | tools                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | -             |
