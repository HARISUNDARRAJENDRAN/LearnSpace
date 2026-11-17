export function summary(values) {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  const at = (p) => sorted.length ? Math.round(sorted[Math.ceil(sorted.length * p) - 1] * 100) / 100 : null;
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), p99: sorted.length >= 100 ? at(0.99) : null };
}

export function successfulTurns(samples) {
  return samples.filter((sample) => sample.status === 200 && sample.messageStatus === "completed" && !sample.failure);
}
