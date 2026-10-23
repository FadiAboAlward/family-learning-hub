# Direct ChatGPT assessment authoring

> **CURRENT OPERATING REFERENCES — 24 October 2026:** Authoring/release must follow the [living Academic SOP v1.20](https://docs.google.com/document/d/1yXdjAX7B8WXcZ4MshpK24feaMFFOCT3h32Az9l7yBZM/edit) and [living Platform QA SOP v1.7](https://docs.google.com/document/d/1X1L7AkxcQFtM6QTp3LW9x4AWods8ZM-ZEX-syE3u9eY/edit). The FLH-033 v1.3 Feature Spec and its Drive revision remain pinned implementation-contract evidence. PR [#179](https://github.com/FadiAboAlward/family-learning-hub/pull/179) records the subsequent Production OAuth and synthetic 40-question validation; this does not grant blanket permission for real-student writes or imply Gmail completion.

Implementation contract: **FLH-FEAT-2026-033 v1.3**, [Drive revision 4](https://docs.google.com/document/d/1qWOtWjVawgpgrFYVuAamYZoPc-eLjz9ezoct23BuoV8/edit), [Issue #172](https://github.com/FadiAboAlward/family-learning-hub/issues/172). Earlier versions remain historical; the original immutable database migration retains its original pin.

Operational tracking: [FLH-033 — Direct ChatGPT Assessment Authoring](https://app.clickup.com/t/z8xb3utdnc).

PR #173 merged at `90449de78fedbc57412b22c658dadc2d39353cdf`. **Testing OAuth, installed ChatGPT invocation, all seven native OAuth tools, a 40-question package through Released, provider video verification and owned cleanup passed** ([observed evidence](https://github.com/FadiAboAlward/family-learning-hub/pull/173#issuecomment-6354039681)). This proves the Testing path, not Production. The v1.3 change only prepares environment-specific consent configuration and the Production activation below; Production writes still require the owner's separate explicit approval.

## What was missing and why option B

Current `learning-api` can stage a validated candidate into an existing empty draft, publish into held, attach a provider-verified video and release atomically. It cannot create that initial quiz/version/program link. Parent RLS permits some direct catalog writes, but orchestrating separate REST inserts in an MCP wrapper would duplicate authorization, introduce partial drafts and leave retry handling outside the application.

The connected Supabase MCP inventory provides management tools such as `execute_sql`, migrations and function deployment. It does not expose parent-authorized `learning-api` commands. Management OAuth is a different trust boundary from a parent's application identity. It must not be used as an authoring credential.

Option A (wrapper only) would still need to implement draft creation and multi-write recovery. Option B adds two small application actions, one private request receipt and an official-SDK MCP transport. It reuses the existing validator, semantic gate, native question/option/key/concept/hint importer, publication state machine and video provider checks. No student runtime or parent authoring UI changes are needed.

Historical baseline evidence reviewed on 19 October 2026: current main `55839bf95c546235b7c2ec9d18b18de24e4a74a0`, academic SOP v1.14, development SOP v1.6, PR #170 / Issue #169 and the authorized operational/comparison records. Detailed learner-linked references remain in private tracking. A recorded pre-network tool-safety block is not evidence of a backend defect; historical snapshots are not instructions to retry it. No blocked operation was retried. PR #170 remains separate and unchanged.

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
8. Call `read_assessment_authoring({request_id})` for a final independent read. Resolve returned relative paths against the configured, verified application origin. Do not invent links from titles or model-generated slugs. Gmail sending remains a separate, explicitly authorized connector operation under the current [Academic SOP v1.20](https://docs.google.com/document/d/1yXdjAX7B8WXcZ4MshpK24feaMFFOCT3h32Az9l7yBZM/edit); this MCP sends no mail and creates no paper.

Application clients can use the new `create_assessment_draft` and `read_assessment_authoring` actions on `learning-api` with a normal current parent session. MCP invokes the same shared authoring handler and the existing publication/video handlers directly, without HTTP token forwarding or administrative SQL.

## Recovery and security boundaries

Creation is all-or-nothing. One workspace/request UUID binds creator, target, quiz definition and candidate hash. Exact retries return the existing status; conflicting retries fail. A second request with the same learner/program/exact candidate hash also fails, even with new target IDs. This is exact-candidate deduplication; the author must still inspect existing assessments for educationally equivalent packages before generating.

After any timeout, lost response or disconnect, **read the original request first**. Preserve the original candidate and identifiers. A missing receipt can mean uncommitted creation or a later authorized erasure of its creator/target. Confirm the original catalog/erasure state before retrying creation with its original payload; do not adopt another quiz, change the IDs or recreate intentionally erased content. The receipt cascades with existing entity erasure paths; existing managed-publication guards remain authoritative. Failed staging rolls back all imported rows and leaves the empty draft resumable. No new deletion/cleanup tool is exposed to ChatGPT.

Only this integration's new requests can be advanced through MCP, by their creating owner/admin. Existing versions cannot be registered or imported into the request ledger. Even direct application staging is bound by a DB trigger to the original request's candidate hash/target/creator. Existing managed publication immutability and RLS remain authoritative.

The remote endpoint is disabled unless enabled with a fixed resource and an explicit OAuth client allowlist. Each request verifies the signed token, exact issuer, resource audience, expiry, approved client, authenticated user and current workspace owner/admin membership. `openid` is an identity scope; application authorization comes from the allowlist, integration-owned request boundary, membership and existing server-only RPCs. Ordinary browser/anon/service-role JWTs are rejected by MCP. Service credentials stay inside the Edge Function, as in the existing application. There are no SQL/table/secret tools or credential arguments and no static bearer fallback.

If ChatGPT safety blocks an operation, stop it and preserve evidence. Do not change tool names, payload encoding, browsers, tokens or transport to retry that operation. A new integration is not approval to repeat a blocked historical action.

## ChatGPT registration and activation gates

Use an **independent Testing backend first**, as completed by the `family-learning-hub-testing` pilot (not legacy `family-quiz-lab`). The same steps below apply to a separately approved Production activation under v1.3; they are not permission to write there. Existing GitHub Runner QA uses a disposable local stack; its loopback URL cannot be registered as a public ChatGPT MCP.

1. On the approved target project with the existing FLH schema, apply only its missing reviewed migration and deploy the reviewed `learning-api` / `assessment-mcp` sources. A fresh empty Testing project needs the complete existing schema first; never replay that setup on Production. Keep `FLH_ASSESSMENT_MCP_ENABLED` unset while preparing identity. These endpoints enforce their own existing parent/learner or OAuth authentication; disabling gateway verification must not remove those checks.
2. Enable Supabase's OAuth 2.1 server on that approved project. Configure its HTTPS authorization UI with normal parent sign-in and explicit approve/deny using `auth.oauth.getAuthorizationDetails`, `approveAuthorization` and `denyAuthorization`. `oauth/consent/` supplies the same minimal static page configured for one allowlisted project, packaged by `scripts/build-assessment-consent.mjs`; see the cloud setup below. Consent is identity setup, not an assessment entry/release UI. Do not substitute browser-token extraction or credentials in chat.
3. Register a dedicated OAuth client for this MCP/environment with authorization-code + S256 PKCE. Prefer pre-registration over opening dynamic registration to arbitrary clients. Copy the exact callback URI displayed by ChatGPT into the client allowlist; never guess a legacy callback or use wildcards. Configure client authentication using the connection's supported method. Any OAuth client secret belongs only in the provider/ChatGPT connection settings, never in prompts or tool arguments.
4. Supabase OAuth defaults to audience `authenticated`. **That default deliberately does not pass this MCP's audience check.** Configure a reviewed client-specific Custom Access Token Hook to mint the exact MCP resource audience for this one client, leaving other clients/session types unchanged. The pilot-specific `supabase/testing/assessment-mcp-token-hook.sql` contains that small SECURITY INVOKER function, with execution restricted to `supabase_auth_admin`. It is deliberately outside automatic migrations and pins only the approved Testing client/resource. Applying its definition does not enable it in Auth; inspect existing hooks before selecting it. Verify the actual signed claims privately through the full OAuth grant, including `client_id`, `scope` containing `openid` and exact `aud`. Verify `getClaims` and `getUser` accept that project configuration; no fallback to the default audience is permitted. Hook/consent/provider compatibility remains an activation prerequisite until proved.
   Supabase's hook input carries the OAuth client in `event.claims.client_id`, not at the event root. The rollback database contract covers issuance, refresh, unrelated sessions/clients, role rejection and execution grants. A successful consent alone does not prove the issued audience or authenticated tool discovery.
5. Set server configuration (non-secret values):

   ```text
   FLH_ASSESSMENT_MCP_RESOURCE=https://<approved-project-ref>.supabase.co/functions/v1/assessment-mcp/mcp
   FLH_ASSESSMENT_MCP_CLIENT_IDS=<dedicated-approved-client-id>
   FLH_ASSESSMENT_MCP_ENABLED=true
   ```

   The issuer is derived server-side as `SUPABASE_URL + /auth/v1`. The resource must share that origin. `YOUTUBE_API_KEY` stays in the existing server secret store; provider-unavailable fails closed. Do not add service keys to ChatGPT.
6. Verify public HTTPS POST reachability with MCP Inspector. An unauthenticated POST must return HTTP 401 with `WWW-Authenticate` pointing to `.../assessment-mcp/.well-known/oauth-protected-resource`. GET that metadata and verify the resource and authorization server exactly. The stateless SDK supports JSON Streamable HTTP responses, not legacy SSE or a stdio-only connection. Check initialization, tool schemas and expired/wrong-resource/wrong-client rejection.
7. In the account/workspace's available ChatGPT plugin/custom-MCP management surface, add a custom MCP server with the exact HTTPS `/mcp` URL, configure OAuth, review the risk warning and create/install the plugin. Current official OpenAI documentation describes **Plugins → plus → Add custom MCP server → Create as a plugin**; availability and labels depend on the account/workspace. Complete the real parent consent yourself. Refresh discovered tools and select the installed plugin in a new conversation.
8. Record real ChatGPT discovery and `read_assessment_authoring` / exact candidate validation, then one newly authorized synthetic package for that environment's dedicated test learner, final readback and owned cleanup. Production requires the explicit approval below; never reuse the erased Testing request or its target identities. Record tool selection, confirmations and failures without tokens/cookies/candidate answer keys. Do not mark **USABLE IN CHATGPT** for an environment before it succeeds there.

The Testing setup has passed these gates. Production still needs its own approved HTTPS artifact, reviewed deployments, client/audience configuration and actual ChatGPT connection. No connector tool can silently complete personal OAuth consent. Production setup/deployment needs the separate explicit approval after QA/review described below.

Official setup references checked 19 October 2026: [Supabase MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication), [OAuth setup and consent](https://supabase.com/docs/guides/auth/oauth-server/getting-started), [OpenAI authentication](https://developers.openai.com/plugins/build/auth), [connect and test a ChatGPT plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt).

### Cloud-first Free Testing consent — completed pilot

The independent backend is `family-learning-hub-testing` / `gzfbkudvvxthbhjsmwsc`. The owner approved a dedicated **Cloudflare Pages Free** static frontend on 22 October 2026. This is a new browser-to-Supabase architecture under v1.1; it does not run or relocate the former Node consent process. No Cloudflare Worker/Function, credential proxy, custom domain, paid add-on or new identity service is needed.

Supabase officially combines Site URL + Authorization Path for its consent redirect. Its default Edge gateway rewrites HTML to plain text, and Storage also returns HTML as text. A Supabase custom domain is a paid add-on and is not intended as frontend hosting. Do not work around MIME handling. See [OAuth setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started), [Edge limits](https://supabase.com/docs/guides/functions/limits), [Storage](https://supabase.com/docs/guides/storage/quickstart), and [static Pages hosting](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/).

The backend's existing fresh-rebuild/authorization evidence and v1 deployments remain separate from new frontend QA. The OAuth server was previously enabled, DCR kept off, and public client `d555d742-2195-4676-bf35-e3d09c25077a` registered without a client secret. The hook definition's behavior/grants were verified, but definition alone does not enable it in Auth. Read actual settings before changing them. Re-read ChatGPT's exact current callback; the old draft's callback may expire.

Build a new static artifact from the reviewed checkout using the approved environment's public configuration only. Testing retains the legacy `FLH_TESTING_PUBLISHABLE_KEY` fallback; Production requires `FLH_PUBLISHABLE_KEY` and cannot use that fallback:

```powershell
$env:FLH_SUPABASE_URL = '<approved Testing or Production project origin>'
$env:FLH_PUBLISHABLE_KEY = '<matching publishable key>'
$env:FLH_ASSESSMENT_MCP_CLIENT_ID = '<actual dedicated client for that project>'
$env:FLH_ASSESSMENT_MCP_CALLBACK = '<exact current ChatGPT callback>'
$env:FLH_QA_HEAD_SHA = '<reviewed full PR commit SHA>'
node scripts/build-assessment-consent.mjs '<new output directory outside the checkout>'
```

This command is an artifact build, with no listening port or application server. It verifies SDK 2.118.0 bytes against the pinned SHA384 and emits only the page/module, public configuration, SDK, 404 page, Cloudflare security headers and a source/hash manifest. It refuses an existing output directory. Never upload the repository, environment files, auth stores or service keys.

Deploy that directory through the approved Pages project's static Direct Upload. Use its actual HTTPS URL, not a guessed address. Verify served build.json/source hashes, correct HTML/JS types, no-store/no-referrer, CSP/frame denial, directory redirects preserving authorization_id and default 404 behavior. Configure the approved target's Site URL/path only under its authorization; see the additional Production gate below. Keep DCR off and MCP disabled during preparation. Do not deploy the existing learner GitHub Pages site or run its preview aggregation.

The page calls Supabase Auth directly with the publishable key. The parent session remains in memory, normal current owner/admin membership is checked, returned details use textContent, callback/client/user/scope are exact, and failed decisions clear the local session. No token/password is sent to Pages application code or a custom API proxy; the static host delivers code only. Testing needs its own confirmed parent Auth user/member. Personal credentials, OAuth consent/install and OTP remain user steps.

The owner approved v1.2's exact Testing scope set `openid email offline_access` after the real ChatGPT connection requested it. `email` identifies the synthetic parent; `offline_access` enables standard provider-managed refresh until revocation. First-consent details must contain all three exactly once, in any order; additional or missing scopes fail closed. The page displays the actual requested scope string. This does not expand parent roles, application authorization, clients or resources, and is not a claim that all ChatGPT configurations require these scopes. The existing supported prior-grant response contains only a provider-generated redirect; exact callback and current membership checks remain, with client/token/resource binding enforced by Supabase and MCP. Supabase's public `authorization_id` is a 32-character alphanumeric identifier, distinct from its internal UUID. Start expired requests afresh through the existing ChatGPT connection; never change stored expiry or copy credentials into a script.

The original 19 October ProcessStartInfo launch rejection remains unresolved. Its exact denying component is unknown; earlier attribution to an automatic approval reviewer was unsupported. The old `scripts/assessment-consent-server.mjs` activation entry point has been removed, not retried or moved. Cloud success would not prove that old denial was lifted. Any new security denial stops the affected operation.

**Testing activation:** the previously pending live checks above subsequently passed, as recorded in the linked PR #173 checkpoint. The disposable request was released and cleaned; its historical links must not be reused or its identifiers recreated. Production remains a separate activation, not an automatic promotion of Testing credentials or approval.

### Production activation — v1.3

The same static page and Supabase OAuth/MCP architecture now accept only the two explicit project origins. `FLH_SUPABASE_URL` selects one; `FLH_PUBLISHABLE_KEY` supplies its public key. The old Testing variables/default remain compatible. Generated CSP allows only the selected backend; displayed labels distinguish Testing from Production. No server-side secret enters the artifact.

Read-only preflight on 23 October 2026 established:

| Component | Production observation / required action |
| --- | --- |
| Project | `gkpoylfozvuwuwqeoduc`, active; independent Testing remains `gzfbkudvvxthbhjsmwsc`. |
| Workspace | Actual Production read confirms `55f9224c-8ba7-4cbc-9f88-713e6a6b41df`, coincidentally the same workspace identity as the Testing fixture. It was verified, not inferred from Testing. |
| Migration | Publication gate/outbox already present. Apply only missing `20261019092245_assessment_authoring_requests.sql`; no catalog replay, broad `db push`, ledger repair or historical rewrite. |
| Edge | `learning-api` v15 lacks create/read authoring. Its five shared deployed modules match merged source. Deploy reviewed learning-api plus the new assessment-mcp; preserve other functions and JWT/application checks. |
| Auth | OAuth server off, no registered OAuth clients or configured Auth hooks; Site URL `http://localhost:3000`, redirect list empty. Record these originals before selecting the client-specific hook. |
| Secrets | Existing modern publishable key and server-side YouTube key are available. MCP resource/client/enabled configuration is absent. Do not rotate/read service keys or copy Testing secrets. |
| Video | Existing Production flag is `enabled=true,test_only=false`; leave it unchanged. |
| Test identity | Existing active dedicated `test` learner and actual parent owner found; use their Production IDs, never Testing learner/user/client IDs. |

After exact-head QA/review, request one Production approval describing this concrete batch, risks and rollback. Before it, do not apply migrations, deploy Production artifacts/functions, save Auth settings/register clients, or enable Production MCP.

After approval:

1. Capture the current learning-api bundle, Auth URL/hook/server settings and relevant counts. Apply only the missing prospective authoring migration through the official migration tool. Recheck RLS/grants, command/trigger definitions and unchanged publication functions. Use a short lock timeout and stop on contention; the Dashboard currently warns about low Disk IO budget, which is not permission to upgrade compute.
2. Deploy merged learning-api and assessment-mcp with MCP disabled. Reuse free static HTTPS Pages hosting for a separately configured Production artifact; preserve the Testing deployment and existing learner GitHub Pages site. No Worker, paid domain or identity service.
3. Obtain the exact Production ChatGPT callback from its new connection setup, register one dedicated public OAuth client with S256 and dynamic registration off. Adapt the existing `supabase/testing/assessment-mcp-token-hook.sql` **as a template only**: replace both its Testing client ID and resource with the actually registered Production values, review the generated definition, preserve SECURITY INVOKER and execute-only Auth-admin grants, and verify ordinary sessions/other clients remain unchanged. Never execute the unchanged Testing SQL in Production or overwrite an existing hook blindly.
4. Build with `FLH_SUPABASE_URL=https://gkpoylfozvuwuwqeoduc.supabase.co`, its publishable key, actual new client/callback and reviewed SHA. Verify artifact hashes/HTTPS/security headers. Set Site URL to the actual static consent origin and Authorization Path `/oauth/consent/`; this also changes default Auth redirects/email-template SiteURL, so keep the original rollback value. Existing password sign-in and learner links must still work.
5. Set the exact Production resource `https://gkpoylfozvuwuwqeoduc.supabase.co/functions/v1/assessment-mcp/mcp` and only the actual new Production client ID. Enable the controlled connection after configuration/boundary checks; unauthorized requests must fail. Owner completes personal sign-in/consent; then verify real ChatGPT discovery/invocation. On authentication/authorization failure disable the new MCP path and stop that operation.
6. Use a fresh labelled synthetic request for the dedicated Production test learner only. Validate/review the exact technical package, create/retry/read-resume/stage/Held/provider video/Released/readback through the actual parent OAuth MCP. Management SQL is only for narrowly owned synthetic fixture setup/cleanup and readback, never assessment authoring. No real-child attempt, historical assessment change, test email or academic-personalization claim. Clean the owned graph with identity and zero-attempt guards; preserve parent/test learner/shared catalog and the original video flag.

Rollback: set MCP enabled=false, revoke only the new client grant if needed, restore captured prior Auth server/path/SiteURL/hook configuration and captured learning-api v15 bundle if necessary. Keep additive receipt schema/data rather than dropping a table with requests. Preserve unrelated project functions, secrets, learner data and existing links. Record deployed/verified/blocked separately in the same PR and ClickUp task; a prepared URL is not Production usability.

### Main compatibility

PR #173 reviewed main `3632189bdce7352f61c47ab17d612a0fe45a3e5d` (#174 catalog, #178 manual-only Pages, #176 dashboard), then merged at `90449de78fedbc57412b22c658dadc2d39353cdf`. The v1.3 preparation starts from that merged main. It neither replays learner catalog registrations nor changes dashboard/runtime/Pages workflows. Production activation uses the separate approved consent artifact, preserving the learner site and Testing backend.

## Verification layers

- `node tests/assessment-consent.unit.mjs`: explicit project/key/client/user/scope/callback restrictions, distinct environment configuration/CSP, narrow static projection, source binding and tampered-SDK denial without creating an output directory.
- `node tests/assessment-consent-browser.mjs`: GitHub Actions only. Actual HTML/JavaScript static artifact rendered through browser network fixtures, with synthetic SDK/Auth and all unrecognized egress denied. Desktop and 390×844 cover RTL/LTR, overflow, login, owner/admin versus teacher/viewer, user/session/details failures, approval/denial, callback rejection and failed-session cleanup. No OAuth consent runtime server is created. Screenshots/manifest bind FLH_QA_HEAD_SHA and use the existing seven-day artifact retention.
- Existing `assessment-authoring.unit.mjs`, actual DB contract, and authenticated Runner remain authoritative for their original boundaries; mocks do not establish live Auth/provider interoperability.
- Hosted deployment/OAuth proof is per environment: Testing's recorded result stands; Production remains NOT RUN until separately approved and observed. CI/source screenshots never substitute for real Auth/ChatGPT.
- Each final synthetic flow uses the exact validator and semantic/source review, original request IDs, authoritative reads/recovery, real provider validation and owned cleanup. Production uses only its dedicated test learner after the explicit approval; real-child writes remain excluded.
