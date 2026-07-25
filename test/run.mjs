// @ts-check
/**
 * Node runner. Optional convenience — the suite is also runnable in a browser
 * via test/index.html, which is the only runner the project actually requires.
 *
 *   node test/run.mjs
 *
 * Uses no packages. Tests that need browser-only APIs guard themselves.
 */
import { run } from './harness.js';

await import('./all.js');

const summary = await run({
  onResult(result) {
    if (result.error === null) {
      console.log(`ok   ${result.name}`);
    } else {
      console.log(`FAIL ${result.name}`);
      console.log(`     ${result.error.message.replace(/\n/g, '\n     ')}`);
    }
  },
});

console.log(`\n${summary.passed}/${summary.total} passed`);
process.exitCode = summary.failed > 0 ? 1 : 0;
