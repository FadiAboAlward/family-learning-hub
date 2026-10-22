# Direct ChatGPT assessment authoring

Implementation contract: **FLH-FEAT-2026-033 v1.2**, [Drive revision 3](https://docs.google.com/document/d/1qWOtWjVawgpgrFYVuAamYZoPc-eLjz9ezoct23BuoV8/edit), [Issue #172](https://github.com/FadiAboAlward/family-learning-hub/issues/172). Version 1.1/revision 2 and version 1.0/revision 1 remain historical; the original immutable database migration retains its original pin.

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
2. Enable Supabase's OAuth 2.1 server on Testing. Configure its HTTPS authorization UI with normal parent sign-in and explicit approve/deny using `auth.oauth.getAuthorizationDetails`, `approveAuthorization` and `denyAuthorization`. `oauth/consent/` supplies a minimal **Testing-only static page**, packaged by `scripts/build-assessment-consent.mjs`; see the cloud setup below. Consent is identity setup, not an assessment entry/release UI. Do not substitute browser-token extraction or credentials in chat.
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

### Cloud-first Free Testing consent

The independent backend is `family-learning-hub-testing` / `gzfbkudvvxthbhjsmwsc`. The owner approved a dedicated **Cloudflare Pages Free** static frontend on 22 October 2026. This is a new browser-to-Supabase architecture under v1.1; it does not run or relocate the former Node consent process. No Cloudflare Worker/Function, credential proxy, custom domain, paid add-on or new identity service is needed.

Supabase officially combines Site URL + Authorization Path for its consent redirect. Its default Edge gateway rewrites HTML to plain text, and Storage also returns HTML as text. A Supabase custom domain is a paid add-on and is not intended as frontend hosting. Do not work around MIME handling. See [OAuth setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started), [Edge limits](https://supabase.com/docs/guides/functions/limits), [Storage](https://supabase.com/docs/guides/storage/quickstart), and [static Pages hosting](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/).

The backend's existing fresh-rebuild/authorization evidence and v1 deployments remain separate from new frontend QA. The OAuth server was previously enabled, DCR kept off, and public client `d555d742-2195-4676-bf35-e3d09c25077a` registered without a client secret. The hook definition's behavior/grants were verified, but definition alone does not enable it in Auth. Read actual settings before changing them. Re-read ChatGPT's exact current callback; the old draft's callback may expire.

Build a new static artifact directory from the reviewed checkout using public configuration only:

```powershell
$env:FLH_TESTING_PUBLISHABLE_KEY = '<Testing publishable key>'
$env:FLH_ASSESSMENT_MCP_CLIENT_ID = 'd555d742-2195-4676-bf35-e3d09c25077a'
$env:FLH_ASSESSMENT_MCP_CALLBACK = '<exact current ChatGPT callback>'
$env:FLH_QA_HEAD_SHA = '<reviewed full PR commit SHA>'
node scripts/build-assessment-consent.mjs '<new output directory outside the checkout>'
```

This command is an artifact build, with no listening port or application server. It verifies SDK 2.118.0 bytes against the pinned SHA384 and emits only the page/module, public configuration, SDK, 404 page, Cloudflare security headers and a source/hash manifest. It refuses an existing output directory. Never upload the repository, environment files, auth stores or service keys.

Deploy that directory through the approved Pages project's static Direct Upload. Use its actual HTTPS URL, not a guessed address. Verify served build.json/source hashes, correct HTML/JS types, no-store/no-referrer, CSP/frame denial, directory redirects preserving authorization_id and default 404 behavior. Configure Testing Site URL to that actual origin and Authorization Path to `/oauth/consent/`. Keep DCR off and MCP disabled during preparation. Do not deploy the existing Production GitHub Pages site or run its preview aggregation.

The page calls Supabase Auth directly with the publishable key. The parent session remains in memory, normal current owner/admin membership is checked, returned details use textContent, callback/client/user/scope are exact, and failed decisions clear the local session. No token/password is sent to Pages application code or a custom API proxy; the static host delivers code only. Testing needs its own confirmed parent Auth user/member. Personal credentials, OAuth consent/install and OTP remain user steps.

The owner approved v1.2's exact Testing scope set `openid email offline_access` after the real ChatGPT connection requested it. `email` identifies the synthetic parent; `offline_access` enables standard provider-managed refresh until revocation. First-consent details must contain all three exactly once, in any order; additional or missing scopes fail closed. The page displays the actual requested scope string. This does not expand parent roles, application authorization, clients or resources, and is not a claim that all ChatGPT configurations require these scopes. The existing supported prior-grant response contains only a provider-generated redirect; exact callback and current membership checks remain, with client/token/resource binding enforced by Supabase and MCP. Supabase's public `authorization_id` is a 32-character alphanumeric identifier, distinct from its internal UUID. Start expired requests afresh through the existing ChatGPT connection; never change stored expiry or copy credentials into a script.

The original 19 October ProcessStartInfo launch rejection remains unresolved. Its exact denying component is unknown; earlier attribution to an automatic approval reviewer was unsupported. The old `scripts/assessment-consent-server.mjs` activation entry point has been removed, not retried or moved. Cloud success would not prove that old denial was lifted. Any new security denial stops the affected operation.

**Current activation status:** cloud source preparation/QA is separate from deployment, real Testing grant, signed-token/getClaims/getUser validation, provider checks and installed ChatGPT tools. Do not claim a final working consent/MCP URL until observed. Keep MCP disabled until security prerequisites and the authorized real integration test are satisfied.

### Main compatibility

Reviewed latest main `3632189bdce7352f61c47ab17d612a0fe45a3e5d`: #174 added a catalog migration, #178 made Production Pages approved-main/manual only, and #176 changed the student dashboard. This consent change neither replays the real-learner catalog migration nor changes dashboard/runtime or Production deployment workflows. Use the isolated Testing backend, not the Production Pages origin.

## Verification layers

- `node tests/assessment-consent.unit.mjs`: Testing/key/client/user/scope/callback restrictions, narrow static file projection, source binding and tampered-SDK denial without creating an output directory.
- `node tests/assessment-consent-browser.mjs`: GitHub Actions only. Actual HTML/JavaScript static artifact rendered through browser network fixtures, with synthetic SDK/Auth and all unrecognized egress denied. Desktop and 390×844 cover RTL/LTR, overflow, login, owner/admin versus teacher/viewer, user/session/details failures, approval/denial, callback rejection and failed-session cleanup. No OAuth consent runtime server is created. Screenshots/manifest bind FLH_QA_HEAD_SHA and use the existing seven-day artifact retention.
- Existing `assessment-authoring.unit.mjs`, actual DB contract, and authenticated Runner remain authoritative for their original boundaries; mocks do not establish live Auth/provider interoperability.
- Hosted Testing must separately prove actual deployed asset/header behavior and true Supabase OAuth grant, denial, issued claims/live session, current membership and ChatGPT connection. Existing Core Browser or source screenshots do not replace this.
- The final synthetic authoring flow uses the existing exact candidate validator and semantic/source review, original request IDs, authoritative reads/recovery, real provider validation and owned cleanup. No real learner data or Production operation is authorized.
