# Manual Production Pages release

Contract: FLH-FEAT-2026-035 v1.0, [Drive revision 2](https://docs.google.com/document/d/1xUTtcA8TVYoRbftWKGNiGX0KxPMGaPhggVQU40PPEhk/edit). Repair issue: #177; first authorized release: #176 / #175.

The Production workflow `.github/workflows/pages.yml` accepts manual dispatch on `main` only. Enter the full approved main commit in `expected_sha`. Before packaging, the workflow verifies the event/ref, dispatch SHA, checkout HEAD and freshly fetched main. A mismatch fails before upload/deployment. A fresh `git archive` of that commit supplies the artifact; local files and unrelated PR branches are excluded. A root `pr-preview` path fails the build. Only the existing `.nojekyll` marker is added.

The official configure/upload/deploy Pages actions, environment, permissions and serialized deployment group remain in place. Independent preview, performance and isolated QA workflows are unchanged. There is no automatic Production push trigger.

For an explicitly authorized release:

1. Verify approved PR heads, exact-head QA/CodeRabbit, actionable threads, current main, protection rules and mergeability. Stop on unexpected drift. Merge only authorized PRs through normal protected PR merges.
2. Record the final main SHA and prior remote workflow states. Confirm no competing deployment is active. Temporarily enable only the Production Pages workflow if it is disabled.
3. Dispatch `pages.yml` with ref `main` and that full `expected_sha`. Record the run, artifact and deployment SHA. On any failure, investigate; never fall back to preview aggregation or bypass protection.
4. Restore the Production workflow's prior disabled state after the run, including on failure. Preview and Live Performance remain disabled.
5. Verify actual HTTP/assets against the approved commit, then the deployed UI at 390×844 and desktop using isolated Testing. Separate live checks from synthetic or Runner-local evidence. Preserve library, history, saved attempts, results, learner isolation and RTL. Do not touch real learners or deploy backend changes.
6. Record merge/deployment SHAs, run URL, served build and actual QA results/limitations in the release PR/Issue. A successful merge/run alone is not full product acceptance.

Regression: `node tests/pages-production.unit.mjs` executes the actual workflow packaging block against disposable Git fixtures. On Windows, set `FLH_QA_BASH` to Git Bash if the default `bash` resolves to WSL.
