---
kind: upgrade-guide
description: "Telemetry, analytics, and DeepSeek request metadata collection are removed."
---

# Upgrade after telemetry removal

English | [中文](guide.zh.md)

## Change

Shipped profiles no longer export product usage, Session logs, feedback, or plugin inventory. The DeepSeek API adapter sends model requests without harness installation or Session identifiers. Feedback stays in the local Session log, and `/feedback` reports the receiving Session id. Previously written Sessions remain readable.

## Migration

1. Remove custom patch rows or overrides for `otel`, `session-telemetry-otel`, `session-log-deepseek`, `deepseek-llm-api-extensions`, `plugin-package-inventory-deepseek`, `desktop-product-telemetry`, `product-analytics`, and `ui-settings-session-log`. Remove the unused `DSH_TELEMETRY_*` and `DSH_PRODUCT_ANALYTICS_*` environment variables from your launcher.
2. Remove plugin references to the deleted telemetry and request-extension packages. Replace `SessionInput.submit(mode, source)` and `ComposerKeyboard.submit(mode, source)` calls with their one-argument forms. Remove any `SidebarRootInjected.trackEntryClick` callback and any `feedback/committed` listener.
3. Run `dsh --profile web --dump-config` and confirm the profile composes without the removed rows. Open an existing Session or record local feedback to verify that Session access still works.
