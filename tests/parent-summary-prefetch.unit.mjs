import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('parent-center-v3.js', 'utf8');

assert.match(source, /function prefetchDashboardSummary\(\)/, 'parent dashboard should expose a summary prefetch helper');
assert.match(source, /summaryPromise&&summaryToken===currentToken/, 'summary prefetch should reuse the in-flight request for the same parent token');

const installStart = source.indexOf('async function installDashboard()');
const installEnd = source.indexOf('function shellPage', installStart);
assert.ok(installStart >= 0 && installEnd > installStart, 'installDashboard source should be discoverable');
const installSource = source.slice(installStart, installEnd);
assert.match(installSource, /const summaryRequest=prefetchDashboardSummary\(\);const d=await summaryRequest/, 'dashboard render should reuse the prefetched activity summary');
assert.match(installSource, /summaryPromise===summaryRequest/, 'dashboard render should expire the consumed summary so later visits refresh');
assert.doesNotMatch(installSource, /call\(ACTIVITY,'parent_session_summary'/, 'dashboard render must not start a second summary request directly');

const routeStart = source.indexOf('function route()');
const routeEnd = source.indexOf('const observer=', routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'parent route source should be discoverable');
const routeSource = source.slice(routeStart, routeEnd);
const prefetchAt = routeSource.indexOf('prefetchDashboardSummary()');
const installAt = routeSource.indexOf('setTimeout(installDashboard,20)');
assert.ok(prefetchAt >= 0 && installAt > prefetchAt, 'parent route should prefetch the summary before waiting for dashboard DOM installation');

console.log('Parent activity summary prefetch regression: PASS');
