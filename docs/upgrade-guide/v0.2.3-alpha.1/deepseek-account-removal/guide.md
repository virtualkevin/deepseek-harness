---
kind: upgrade-guide
description: "DeepSeek account sign-in, account model routing, and related settings and APIs are removed."
---

# Migrate from DeepSeek account sign-in

English | [中文](guide.zh.md)

## Change

Web and Desktop use API-key provider configuration for DeepSeek inference. This release removes DeepSeek account sign-in, account models, notifications, balance and billing views, the `account` RPC namespace, and the Desktop `dshPlatform` and `dshOnboarding` account bridges. DeepSeek-hosted search and fetch use API keys. Existing Session history can still display the model used for a past request.

## Migration

1. Open **Settings → Models** and save a DeepSeek API key, or set `DEEPSEEK_API_KEY` in the environment used to launch dsh. Select a model from **DeepSeek API** before continuing a Session that previously used an account model.
2. In custom profile patches, remove `deepseek-account`, `llm-deepseek-account`, `ui-settings-account`, and `ui-account-notifications` rows or overrides. Use `llm-deepseek-api-key` for API-key provider configuration. Replace `deepseek-account` provider selections with `deepseek-official` and choose a model that the API lists.
3. Remove `searchBilling` and `fetchBilling` from `web-deepseek-api` overrides. Endpoint-specific `searchBaseURL`, `searchApiKeyEnv`, `fetchBaseURL`, and `fetchApiKeyEnv` remain available. Choose another translation provider if you previously selected the DeepSeek Account route.
4. Remove calls to the `account` RPC namespace and the sign-in-specific `session/initializeDefaultModel` method. For custom `DeepSeekAuthRequest` call sites, use API-key authorization and remove the account route and connection fields. Configure and select a provider model using the normal model-selection flow. Verify the new selection by sending a request.
