// Repeatable Home timing: run with HOME_BENCHMARK_URL and one or more cookies.
// Example: HOME_BENCHMARK_URL=http://localhost:3000 HOME_BENCHMARK_POPULATED_COOKIE='learnspace_session=...' pnpm exec node scripts/benchmark-home.mjs
const baseUrl = process.env.HOME_BENCHMARK_URL;
const iterations = Math.max(2, Number(process.env.HOME_BENCHMARK_ITERATIONS ?? 8));
if (!baseUrl) throw new Error("Set HOME_BENCHMARK_URL");

const scenarios = [
  ["brand-new", process.env.HOME_BENCHMARK_BRAND_NEW_COOKIE],
  ["populated", process.env.HOME_BENCHMARK_POPULATED_COOKIE],
  ["small-catalogue", process.env.HOME_BENCHMARK_SMALL_CATALOGUE_COOKIE],
  ["large-catalogue", process.env.HOME_BENCHMARK_LARGE_CATALOGUE_COOKIE],
].filter((entry) => entry[1]);
if (scenarios.length === 0) throw new Error("Set at least one HOME_BENCHMARK_*_COOKIE");

function percentile(values, percentage) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percentage / 100) * sorted.length) - 1);
  return Number((sorted[index] ?? 0).toFixed(2));
}

async function measure(cookie, scenario) {
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/app`, { headers: { cookie } });
    await response.arrayBuffer();
    samples.push({
      scenario: index === 0 ? `${scenario}:cold` : `${scenario}:warm`,
      status: response.status,
      elapsedMs: performance.now() - started,
    });
  }
  return samples;
}

const samples = (await Promise.all(scenarios.map(([name, cookie]) => measure(cookie, name)))).flat();
const report = Object.fromEntries(Object.entries(Object.groupBy(samples, (sample) => sample.scenario)).map(([name, values]) => {
  const timings = values.map((sample) => sample.elapsedMs);
  return [name, {
    count: timings.length,
    p50Ms: percentile(timings, 50),
    p95Ms: percentile(timings, 95),
    maxMs: Number(Math.max(...timings).toFixed(2)),
    statuses: Object.fromEntries(Object.entries(Object.groupBy(values, (sample) => String(sample.status))).map(([status, rows]) => [status, rows.length])),
  }];
}));
console.log(JSON.stringify({ iterations, scenarios: scenarios.map(([name]) => name), report, samples: samples.map(({ scenario, status, elapsedMs }) => ({ scenario, status, elapsedMs: Number(elapsedMs.toFixed(2)) })) }, null, 2));
