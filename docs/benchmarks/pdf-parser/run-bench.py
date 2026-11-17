#!/usr/bin/env python3
"""Build scratch Rust drivers and measure candidate/upstream extraction."""
from __future__ import annotations
import argparse
import concurrent.futures
import hashlib
import json
import math
import os
import platform
import resource
from pathlib import Path
import shutil
import statistics
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
FORK_DIR = REPO / "vendor/pdf-inspector-researchpapers"
DRIVER_DIR = HERE / "driver"
LOCK_DIR = HERE / "locks"
FORK_SHA = "6845225193200a7779e69b2021e15fb1293b0adc"
CORE = ["1706.03762v7", "1810.04805v2", "2005.14165v4", "2010.11929v2", "2006.11239v2"]


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, check=True, text=True, capture_output=True, **kwargs)


def build(source: Path, destination: Path, research: bool, target: Path, lockfile: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copytree(DRIVER_DIR, destination, dirs_exist_ok=True)
    manifest = (destination / "Cargo.toml").read_text()
    manifest = manifest.replace("../../../../vendor/pdf-inspector-researchpapers", str(source))
    (destination / "Cargo.toml").write_text(manifest)
    if lockfile.exists():
        shutil.copyfile(lockfile, destination / "Cargo.lock")
    env = os.environ.copy()
    env["CARGO_TARGET_DIR"] = str(target)
    args = ["cargo", "build", "--release", "--manifest-path", str(destination / "Cargo.toml")]
    if lockfile.exists():
        args.insert(2, "--locked")
    if research:
        args += ["--features", "research"]
    run(args, env=env)
    if not lockfile.exists():
        lockfile.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(destination / "Cargo.lock", lockfile)
    return target / "release/pdf-parser-bench"


def timed(binary: Path, mode: str, pdf: Path) -> dict:
    completed = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), "--measure", str(binary), mode, str(pdf)],
        check=False, text=True, capture_output=True,
    )
    if completed.returncode:
        return {"error": completed.stderr.strip(), "returncode": completed.returncode}
    measured = json.loads(completed.stdout)
    if measured["returncode"]:
        return {"error": measured["stderr"].strip(), "returncode": measured["returncode"]}
    fields = measured["stdout"].strip().split("\t")
    return {
        "latency_ms": measured["latency_ms"],
        "signature": fields[1],
        "markdown_bytes": int(fields[2]),
        "pages": int(fields[3]),
        "pdf_type": fields[4],
        "ocr_pages": int(fields[5]),
        "cpu_ms": measured["cpu_ms"],
        "peak_rss_kb": measured["peak_rss_kb"],
    }


def measure_child(binary: str, mode: str, pdf: str) -> None:
    started = time.perf_counter()
    completed = subprocess.run([binary, mode, pdf], text=True, capture_output=True)
    latency_ms = (time.perf_counter() - started) * 1000
    usage = resource.getrusage(resource.RUSAGE_CHILDREN)
    print(json.dumps({
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "latency_ms": latency_ms,
        "cpu_ms": (usage.ru_utime + usage.ru_stime) * 1000,
        "peak_rss_kb": usage.ru_maxrss,
    }))


def run_direct(binary: Path, mode: str, pdf: Path) -> dict:
    completed = subprocess.run([str(binary), mode, str(pdf)], check=False, text=True, capture_output=True)
    if completed.returncode:
        return {"error": completed.stderr.strip(), "returncode": completed.returncode}
    fields = completed.stdout.strip().split("\t")
    return {"pages": int(fields[3])}


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(p * len(ordered)) - 1)]


def stats(samples: list[dict]) -> dict:
    ok = [s for s in samples if "error" not in s]
    if not ok:
        return {"samples": len(samples), "errors": [s["error"] for s in samples]}
    latencies = [s["latency_ms"] for s in ok]
    pages = statistics.median(s["pages"] for s in ok)
    return {
        "runs": len(ok),
        "latency_ms": {"p50": statistics.median(latencies), "p95": percentile(latencies, .95), "p99": percentile(latencies, .99)},
        "pages_per_second_at_p50": pages / (statistics.median(latencies) / 1000) if statistics.median(latencies) else None,
        "cpu_ms_median": statistics.median(s["cpu_ms"] for s in ok),
        "peak_rss_kb_median": statistics.median(s["peak_rss_kb"] for s in ok),
        "peak_rss_kb_max": max(s["peak_rss_kb"] for s in ok),
        "page_count": int(pages),
        "classification": ok[0]["pdf_type"],
        "ocr_pages": ok[0]["ocr_pages"],
        "signature": ok[0]["signature"],
        "markdown_bytes": ok[0]["markdown_bytes"],
    }


def corpus_stats(samples: dict[str, list[dict]], runs: int) -> dict:
    rounds = []
    for index in range(runs):
        group = [samples[name][index] for name in CORE]
        if all("error" not in sample for sample in group):
            rounds.append({
                "latency_ms": sum(sample["latency_ms"] for sample in group),
                "pages": sum(sample["pages"] for sample in group),
                "cpu_ms": sum(sample["cpu_ms"] for sample in group),
                "peak_rss_kb": max(sample["peak_rss_kb"] for sample in group),
            })
    if not rounds:
        return {"runs": 0, "errors": runs}
    latencies = [item["latency_ms"] for item in rounds]
    return {
        "runs": len(rounds),
        "errors": runs - len(rounds),
        "latency_ms": {"p50": statistics.median(latencies), "p95": percentile(latencies, .95), "p99": percentile(latencies, .99)},
        "pages_per_second_at_p50": statistics.median(item["pages"] for item in rounds) / (statistics.median(latencies) / 1000),
        "cpu_ms_median": statistics.median(item["cpu_ms"] for item in rounds),
        "peak_rss_kb_median": statistics.median(item["peak_rss_kb"] for item in rounds),
        "peak_rss_kb_max": max(item["peak_rss_kb"] for item in rounds),
    }


def main() -> None:
    if len(sys.argv) == 5 and sys.argv[1] == "--measure":
        measure_child(sys.argv[2], sys.argv[3], sys.argv[4])
        return
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=HERE / "corpus")
    parser.add_argument("--runs", type=int, default=24)
    parser.add_argument("--warmups", type=int, default=3)
    parser.add_argument("--upstream-ref", default="main", help="upstream branch, tag, or commit SHA; resolved SHA is recorded")
    parser.add_argument("--out", type=Path, default=HERE / "results/latest.json")
    args = parser.parse_args()
    core_pdfs = [args.corpus / f"{paper}.pdf" for paper in CORE]
    if any(not pdf.is_file() for pdf in core_pdfs):
        raise SystemExit("Run fetch-corpus.py first; five pinned corpus PDFs are missing")
    with tempfile.TemporaryDirectory(prefix="learnspace-pdf-bench-") as temp:
        scratch = Path(temp)
        upstream_src = scratch / "upstream"
        run(["git", "init", "--quiet", str(upstream_src)])
        run(["git", "-C", str(upstream_src), "remote", "add", "origin", "https://github.com/firecrawl/pdf-inspector.git"])
        run(["git", "-C", str(upstream_src), "fetch", "--quiet", "--depth", "1", "origin", args.upstream_ref])
        run(["git", "-C", str(upstream_src), "checkout", "--quiet", "--detach", "FETCH_HEAD"])
        upstream_sha = run(["git", "-C", str(upstream_src), "rev-parse", "HEAD"]).stdout.strip()
        fork_lock = LOCK_DIR / f"fork-{FORK_SHA}.lock"
        upstream_lock = LOCK_DIR / f"upstream-{upstream_sha}.lock"
        bins = {
            "fork-normal": build(FORK_DIR, scratch / "fork-normal", False, scratch / "target-normal", fork_lock),
            "research-fast": build(FORK_DIR, scratch / "research-fast", True, scratch / "target-fast", fork_lock),
            "upstream-release": build(upstream_src, scratch / "upstream-build", False, scratch / "target-upstream", upstream_lock),
        }
        modes = {"fork-normal": "normal", "research-fast": "research", "upstream-release": "normal"}
        corpus: dict[str, Path] = {p.stem: p for p in core_pdfs}
        for name in ("2401.02954v1", "2307.09288v1", "image-only-scan", "two-column-fixture", "truncated"):
            path = args.corpus / (name + ".pdf")
            if path.is_file():
                corpus[name] = path
        # Reproduce the fork's three excluded corpus warm-ups and 24 rotating complete corpus rounds.
        for _ in range(args.warmups):
            for mode in bins:
                for pdf in core_pdfs:
                    timed(bins[mode], modes[mode], pdf)
        samples: dict[str, dict[str, list[dict]]] = {mode: {name: [] for name in corpus} for mode in bins}
        for round_index in range(args.runs):
            order = list(bins)
            shift = round_index % len(order)
            order = order[shift:] + order[:shift]
            for mode in order:
                for name, pdf in corpus.items():
                    samples[mode][name].append(timed(bins[mode], modes[mode], pdf))
        output_equivalence = {}
        for name in CORE:
            signatures = {mode: stats(samples[mode][name])["signature"] for mode in bins}
            outputs = {}
            for mode, binary in bins.items():
                path = scratch / f"{name}-{mode}.md"
                run([str(binary), modes[mode], str(corpus[name]), str(path)])
                outputs[mode] = path.read_bytes()
            output_equivalence[name] = {
                "signatures": signatures,
                "byte_identical": len(set(outputs.values())) == 1,
                "research_matches_fork_normal": outputs["research-fast"] == outputs["fork-normal"],
                "fork_matches_upstream": outputs["fork-normal"] == outputs["upstream-release"],
                "all_equal": len(set(outputs.values())) == 1 and all(value is not None for value in signatures.values()),
            }
        throughput = {}
        throughput_repetitions = 5
        throughput_workload = core_pdfs * throughput_repetitions
        for mode, binary in bins.items():
            throughput[mode] = {}
            for concurrency in (1, 4, 8):
                started = time.perf_counter()
                if concurrency == 1:
                    group = [run_direct(binary, modes[mode], pdf) for pdf in throughput_workload]
                else:
                    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
                        group = list(pool.map(lambda pdf: run_direct(binary, modes[mode], pdf), throughput_workload))
                elapsed = time.perf_counter() - started
                successful = [item for item in group if "error" not in item]
                throughput[mode][str(concurrency)] = {
                    "documents": len(successful), "errors": len(group) - len(successful), "elapsed_s": elapsed,
                    "documents_per_second": len(successful) / elapsed,
                    "pages_per_second": sum(item["pages"] for item in successful) / elapsed,
                }
        result = {
            "benchmark": "LearnSpace PDF parser fork comparison",
            "upstream": {"ref": args.upstream_ref, "sha": upstream_sha},
            "fork": {"sha": FORK_SHA},
            "dependency_lock_sha256": {
                "fork": hashlib.sha256(fork_lock.read_bytes()).hexdigest(),
                "upstream": hashlib.sha256(upstream_lock.read_bytes()).hexdigest(),
            },
            "method": {"warmups": args.warmups, "runs_per_document": args.runs, "throughput_repetitions": throughput_repetitions, "resource_measurement": "Python resource.getrusage(RUSAGE_CHILDREN), isolated helper per parser process; parser latency includes process startup; corpus inputs from fetch-corpus.py"},
            "environment": {
                "platform": platform.platform(),
                "machine": platform.machine(),
                "processor": platform.processor(),
                "cpu_count": os.cpu_count(),
                "python": platform.python_version(),
                "rustc": run(["rustc", "--version"]).stdout.strip(),
                "cargo": run(["cargo", "--version"]).stdout.strip(),
            },
            "documents": {mode: {name: stats(values) for name, values in by_pdf.items()} for mode, by_pdf in samples.items()},
            "five_paper_corpus_summary": {
                mode: corpus_stats(samples[mode], args.runs)
                for mode in bins
            },
            "output_equivalence": output_equivalence,
            "throughput": throughput,
        }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    if not all(item["research_matches_fork_normal"] for item in output_equivalence.values()):
        raise SystemExit("Research fast path Markdown differs from fork normal path for at least one pinned paper")


if __name__ == "__main__":
    main()
