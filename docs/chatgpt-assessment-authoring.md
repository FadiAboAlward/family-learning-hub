# Direct ChatGPT assessment authoring

Implementation contract: **FLH-FEAT-2026-033 v1.0**, [Drive revision 1](https://docs.google.com/document/d/1qWOtWjVawgpgrFYVuAamYZoPc-eLjz9ezoct23BuoV8/edit), [Issue #172](https://github.com/FadiAboAlward/family-learning-hub/issues/172).

Operational tracking: [FLH-033 — Direct ChatGPT Assessment Authoring](https://app.clickup.com/t/z8xb3utdnc).

This PR prepares an application-authorized integration. Source QA, hosted Testing setup and actual ChatGPT use are separate results. **A live ChatGPT invocation is not yet proved.** See the Testing pilot record and activation gates below. Production rollout is excluded.

## What was missing and why option B

Current `learning-api` can stage a validated candidate into an existing empty draft, publish into held, attach a provider-verified video and release atomically. It cannot create that initial quiz/version/program link. Parent RLS permits some direct catalog writes, but orchestrating separate REST inserts in an MCP wrapper would duplicate authorization, introduce partial drafts and leave retry handling outside the application.

The connected Supabase MCP inventory provides management tools such as `execute_sql`, migrations and function deployment. It does not expose parent-authorized `learning-api` commands. Management OAuth is a different trust boundary from a parent's application identity. It must not be used as an authoring credential.

Option A (wrapper only) would still need to implement draft creation and multi-write recovery. Option B adds two small application actions, one private request receipt and an official-SDK MCP transport. It reuses the existing validator, semantic gate, native question/option/key/concept/hint importer, publication state machine and video provider checks. No student runtime or parent authoring UI changes are needed.

Evidence reviewed on 19 October 2026: current main `55839bf95c546235b7c2ec9d18b18de24e4a74a0`, academic SOP v1.14, development SOP v1.6, PR #170 / Issue #169 and the authorized operational/comparison records. Detailed learner-linked references remain in private tracking. A recorded pre-network tool-safety block is not evidence of a backend defect; historical snapshots are not instructions to retry it. No blocked operation was retried. PR #170 remains separate and unchanged.

## Tools and calls

| Tool | Purpose |
| --- | --- |
| `validate_assessment_candidate` | Existing deterministic academic gate, publication-format support and canonical SHA-256; semantic review remains REQUIRED. |
| `create_assessment_draft` | Validate the exact candidate and review; atomically create a fresh draft quiz/version/program link and durable request receipt. |
| `read_assessment_authoring` | Resume by original request UUID; return authoritative target/hash/state/counts and final links without candidate/answer keys. |
| `stage_assessment` | Existing academic/semantic importer; exact request/target/hash binding. |
| `publish_assessment` | Existing publish-to-held command; no learner activation. |
| `attach_optional_video` | Existing exact-context video attachment plus official provider status validation; explicit sequence position. |
| `release_assessment` | Existing atomic content/authorization/rollout/video gate, followed by status readback. |

`tools/list` provides the structured input schemas. The complete academic candidate shape remains owned by `scripts/academic-content-quality.mjs`; see `tests/fixtures/assessment-publication/valid-package.json` for a **synthetic technical fixture**, never real learner source evidence.

Before calling tools, review current Student Academic State, assigned book/source and newer live evidence using the existing authorized read connectors. This integration does not infer the student's state, create catalog concepts, or replace source review. Use existing program/curriculum/subject/concept IDs. Author the exact canonical 20 Learning + 20 distinct Exam questions and four progressive hints per Learning item. Persist the candidate and request/target identifiers securely in the normal handoff, outside logs.

1. Run `validate_assessment_candidate({candidate})`. Review every warning and complete the package-level semantic/source/learner review. A validator PASS does not establish semantic PASS.
2. Allocate and retain one `request_id` UUID and fresh target UUIDs for `quiz_id` / `quiz_version_id`. Record the existing `learner_id` / `program_id`.
3. Call `create_assessment_draft` with `request_id`, `target`, `quiz: {slug,title,subject_id,curriculum_id}`, `candidate`, and `semantic_review`. The review uses the same fields as the existing `stage_assessment` contract: exact workspace/target/hash, PASS, reviewer/source/scope/authority references, timestamp and explicit ACCEPTED warning dispositions. The server supplies `reviewed_by` from authentication.
4. Call `stage_assessment` with the same request/hash/target/candidate/review. It returns `{operation,status}`. Native rows are written only by the existing transaction.
5. Call `publish_assessment({request_id,candidate_sha256})`. Confirm status `held` and hidden quiz.
6. Review a genuinely relevant video, then call `attach_optional_video({request_id,candidate_sha256,candidate: video})`. Video uses the existing IDs/context/title/language/rationale contract and an explicit `position` to keep retries stable. The caller cannot supply provider verification fields.
7. Call `release_assessment({request_id,candidate_sha256})`; verify `status.state = released`, `quiz_status = active`, `version_state = published`, intended target and server-returned Learning/Exam paths.
8. Call `read_assessment_authoring({request_id})` for a final independent read. Resolve returned relative paths against the configured, verified application origin. Do not invent links from titles or model-generated slugs. Gmail sending remains a separate, explicitly authorized connector operation under SOP v1.14; this MCP sends no mail and creates no paper.

Application clients can use the new `create_assessment_draft` and `read_assessment_authoring` actions on `learning-api` with a normal current parent session. MCP invokes the same shared authoring handler and the existing publication/video handlers directly, without HTTP token forwarding or administrative SQL.

## Recovery and security boundaries

Creation is all-or-nothing. One workspace/request UUID binds creator, target, quiz definition and candidate hash. Exact retries return the existing status; conflicting retries fail. A second request with the same learner/program/exact candidate hash also fails, even with new target IDs. This is exact-candidate deduplication; the author must still inspect existing assessments for educationally equivalent packages before generating.

After any timeout, lost response or disconnect, **read the original request first**. Preserve the original candidate and identifiers. A missing receipt can mean uncommitted creation or a later authorized erasure of its creator/target. Confirm the original catalog/erasure state before retrying creation with its original payload; do not adopt another quiz, change the IDs or recreate intentionally erased content. The receipt cascades with existing entity erasure paths; existing managed-publication guards remain authoritative. Failed staging rolls back all imported rows and leaves the empty draft resumable. No new deletion/cleanup tool is exposed to ChatGPT.

Only this integration's new requests can be advanced through MCP, by their creating owner/admin. Existing versions cannot be registered or imported into the request ledger. Even direct application staging is bound by a DB trigger to the original request's candidate hash/target/creator. Existing managed publication immutability and RLS remain authoritative.

The remote endpoint is disabled unless enabled with a fixed resource and an explicit OAuth client allowlist. Each request verifies the signed token, exact issuer, resource audience, expiry, approved client, authenticated user and current workspace owner/admin membership. `openid` is an identity scope; application authorization comes from the allowlist, integration-owned request boundary, membership and existing server-only RPCs. Ordinary browser/anon/service-role JWTs are rejected by MCP. Service credentials stay inside the Edge Function, as in the existing application. There are no SQL/table/secret tools or credential arguments and no static bearer fallback.

If ChatGPT safety blocks an operation, stop it and preserve evidence. Do not change tool names, payload encoding, browsers, tokens or transport to retry that operation. A new integration is not approval to repeat a blocked historical action.

## ChatGPT registration and activation gates

Use an **independent Testing backend first**. The approved pilot uses the new Free `family-learning-hub-testing` project, not the separate legacy `family-quiz-lab`. Existing GitHub Runner QA creates a disposable local Supabase stack and cleans it up; that validates code/API/database behavior, but its loopback URL cannot be registered as a public ChatGPT MCP.

1. On an approved Testing project with the existing FLH schema, apply the reviewed migration and deploy the reviewed `learning-api` / `assessment-mcp` sources. A fresh empty project needs the complete existing schema first. Keep `FLH_ASSESSMENT_MCP_ENABLED` unset while preparing identity. These endpoints enforce their own existing parent/learner or OAuth authentication; disabling gateway verification must not remove those checks.
2. Enable Supabase's OAuth 2.1 server on Testing. Configure its real authorization/consent endpoint with normal parent sign-in and explicit approve/deny using `auth.oauth.getAuthorizationDetails`, `approveAuthorization` and `denyAuthorization`. `oauth/consent/` now supplies a minimal **Testing-only** page served by `scripts/assessment-consent-server.mjs`; see the pilot setup below. Consent is identity setup, not an assessment entry/release UI. Do not substitute browser-token extraction or credentials in chat.
3. Register a dedicated OAuth client for this MCP/environment with authorization-code + S256 PKCE. Prefer pre-registration over opening dynamic registration to arbitrary clients. Copy the exact callback URI displayed by ChatGPT into the client allowlist; never guess a legacy callback or use wildcards. Configure client authentication using the connection's supported method. Any OAuth client secret belongs only in the provider/ChatGPT connection settings, never in prompts or tool arguments.
4. Supabase OAuth defaults to audience `authenticated`. **That default deliberately does not pass this MCP's audience check.** Configure a reviewed client-specific Custom Access Token Hook to mint the exact MCP resource audience for this one client, leaving other clients/session types unchanged. The pilot-specific `supabase/testing/assessment-mcp-token-hook.sql` contains that small SECURITY INVOKER function, with execution restricted to `supabase_auth_admin`. It is deliberately outside automatic migrations and pins only the approved Testing client/resource. Applying its definition does not enable it in Auth; inspect existing hooks before selecting it. Verify the actual signed claims privately through the full OAuth grant, including `client_id`, `scope` containing `openid` and exact `aud`. Verify `getClaims` and `getUser` accept that project configuration; no fallback to the default audience is permitted. Hook/consent/provider compatibility remains an activation prerequisite until proved.
5. Set server configuration (non-secret values):

   ```text
   FLH_ASSESSMENT_MCP_RESOURCE=https://<testing-ref>.supabase.co/functions/v1/assessment-mcp/mcp
   FLH_ASSESSMENT_MCP_CLIENT_IDS=<dedicated-approved-client-id>
   FLH_ASSESSMENT_MCP_ENABLED=true
   ```

   The issuer is derived server-side as `SUPABASE_URL + /auth/v1`. The resource must share that origin. `YOUTUBE_API_KEY` stays in the existing server secret store; provider-unavailable fails closed. Do not add service keys to ChatGPT.
6. Verify public HTTPS POST reachability with MCP Inspector. An unauthenticated POST must return HTTP 401 with `WWW-Authenticate` pointing to `.../assessment-mcp/.well-known/oauth-protected-resource`. GET that metadata and verify the resource and authorization server exactly. The stateless SDK supports JSON Streamable HTTP responses, not legacy SSE or a stdio-only connection. Check initialization, tool schemas and expired/wrong-resource/wrong-client rejection.
7. In the account/workspace's available ChatGPT plugin/custom-MCP management surface, add a custom MCP server with the exact HTTPS `/mcp` URL, configure OAuth, review the risk warning and create/install the plugin. Current official OpenAI documentation describes **Plugins → plus → Add custom MCP server → Create as a plugin**; availability and labels depend on the account/workspace. Complete the real parent consent yourself. Refresh discovered tools and select the installed plugin in a new conversation.
8. Record a real ChatGPT `tools/list` discovery and `read_assessment_authoring` / exact candidate validation invocation, then one authorized new Testing-only package flow, final readback and owned cleanup evidence. Record tool selection, confirmations and failures without tokens/cookies/candidate answer keys. Do not mark **USABLE IN CHATGPT** before this succeeds.

The remaining setup is therefore concrete: an approved reachable Testing host, deployed reviewed sources, OAuth consent route/client/audience customization, and actual ChatGPT installation/consent/invocation. No connector-registration tool exposed to this development session can silently complete the user's OAuth consent. Production setup/deployment needs a separate explicit approval after QA/review.

Official setup references checked 19 October 2026: [Supabase MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication), [OAuth setup and consent](https://supabase.com/docs/guides/auth/oauth-server/getting-started), [OpenAI authentication](https://developers.openai.com/plugins/build/auth), [connect and test a ChatGPT plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt).

### Free Testing pilot and minimal consent setup

The owner approved the new Free project `gzfbkudvvxthbhjsmwsc` in the existing organization. Before pausing (not deleting) the independent legacy lab, a private local JSON snapshot of its 27 attempts was verified; no legacy records or Production data were imported. The new empty project was initialized from the 122 ordered SQL files at backend-source head `bd7ed5f2cdf32a0b5d54b9da24ae4930efdf0116`. Native MCP transport required nine bounded source snapshot parts. Their remote ledger timestamps are **not** canonical per-file migration versions; do not blindly push the historical migration list again. The source-hash/part manifest is retained in the private operational handoff.

Hosted readback: fresh-rebuild contract passed inside rollback, zero retained attempts/answers/Auth users, all public tables have RLS, and the private request receipt is not directly readable/writable by authenticated clients. Reviewed backend-source deployments are `learning-api` v1 and `assessment-mcp` v1. Unauthenticated probes returned `401 AUTH_REQUIRED` and `503 ASSESSMENT_MCP_DISABLED`, respectively. These are deployment/closed-boundary checks, not a successful OAuth grant.

OAuth Server was enabled after the owner's explicit confirmation; DCR remains off. ChatGPT's actual Add custom MCP server form exposed public-client authentication `none` and a per-connection callback. The dedicated manually registered public client is `d555d742-2195-4676-bf35-e3d09c25077a`; it has no client secret and no parent consent/grant. Copy a fresh form's exact callback if that connection is restarted; do not assume the recorded callback survives cancelling the draft. Update the one client's redirect allowlist and local public configuration together.

The consent server serves only its page/module, public configuration and integrity-checked Supabase SDK 2.118.0. It binds `127.0.0.1:3000`, denies unexpected Host headers and repository paths, sends no-store/no-referrer/frame-denial headers, and never logs request URLs, passwords, tokens or authorization codes. The browser session stays in memory. Production/legacy origins, secret keys, unexpected clients/users/scopes and off-allowlist callbacks fail closed. There is no registration, question entry, assessment publishing UI, privileged proxy or new hosting service.

Normal setup, **only when local execution is permitted**:

```powershell
# Public configuration only. Obtain the actual publishable key through the native Supabase tool.
$env:FLH_TESTING_PUBLISHABLE_KEY = '<sb_publishable_...>'
$env:FLH_ASSESSMENT_MCP_CLIENT_ID = 'd555d742-2195-4676-bf35-e3d09c25077a'
$env:FLH_ASSESSMENT_MCP_CALLBACK = '<exact current ChatGPT callback>'
node scripts/assessment-consent-server.mjs
```

Keep the default Testing Site URL `http://localhost:3000` and authorization path `/oauth/consent` for this local pilot. The public MCP itself still runs on Supabase HTTPS; ChatGPT never calls localhost. The user's browser needs the local page during sign-in/consent. No long-lived parent session is copied from another application. Testing needs its own confirmed Auth parent user and normal owner/admin membership; the Supabase dashboard login is not that application user. Credentials and final grant consent remain personal setup steps.

**Current execution stop:** automatic approval review rejected the background start of this local consent process with `blocked by policy`, without a detailed reason. The command was not retried or moved to another tool/transport. Unit tests passed before that rejection, but the actual consent server start, browser/login flow and live OAuth/ChatGPT invocation are NOT RUN. The Testing hook definition and its SQL behavior/grants were verified; Auth has not been switched to it. MCP remains disabled. Resolve the execution-policy decision explicitly before continuing; this runbook is not an instruction to retry a blocked operation.

## Verification layers

- `node scripts/academic-content-quality.mjs tests/fixtures/assessment-publication/valid-package.json`: existing exact synthetic package PASS; three review warnings are explicitly accepted **only as technical fixtures**, not real academic/source approval.
- `node tests/assessment-authoring.unit.mjs`: official SDK protocol/schemas plus shared academic/semantic/session/role/client/resource checks, safe errors and full synthetic orchestration. Persistence/Auth/provider are mocked here.
- `node tests/assessment-consent.unit.mjs`: Testing/public-key restriction, duplicate authorization IDs, exact client/user/scope/callback binding, host denial, narrow served routes and HTTP privacy headers. Synthetic local HTTP only, no real credentials/grants. Actual sign-in/consent rendering and installed ChatGPT evidence remain separate.
- `node tests/assessment-authoring.contract.mjs`: real disposable Core QA Postgres, RLS/ACL/tenant/review checks, partial staging rollback, concurrent duplicate requests, native 40-question import and full release/readback with a clearly synthetic provider receipt; rollback and finally cleanup. No provider network proof.
- `verifyAssessmentAuthoringApi` in the existing authenticated Runner: real local Auth grant and `learning-api` writes for the dedicated test learner, wrong role/missing session/review/metadata/conflict checks, draft → stage → held and missing-video release denial, readback and owned cleanup. This is not a live OAuth/YouTube or installed ChatGPT test.
- Required existing Static quality, Browser smoke and authenticated Runner results remain bound to the exact PR head. CodeRabbit and Change Stack remain separate review gates. TestSprite on an undeployed OAuth endpoint cannot substitute for these tests; record any unexecuted exploratory/activation checks explicitly.

The original authoring transport added no UI. The activation addition has a small identity-consent page only; its browser/rendered-flow QA remains NOT RUN at the execution-policy stop. Dashboard setup screenshots are private operational evidence, not proof that the consent page works. No learner/assessment-authoring UI is added. Learner math, attempts, scoring, mastery, XP and rewards are unchanged. No Production writes, deployment or PR #170 edits are authorized by this implementation.
