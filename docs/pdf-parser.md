# PDF parser package

`@learnspace/pdf-parser` provides one explicit routing API. The caller must establish provenance before selecting the fast path; the parser does not infer that a URL or upload is trusted.

```ts
import { parsePaperPdf } from "@learnspace/pdf-parser";
import { readFile } from "node:fs/promises";

const result = await parsePaperPdf(new Uint8Array(await readFile("paper.pdf")), {
  source: "verified-native", // only when acquisition metadata guarantees native text, not from URL provenance alone
  signal: request.signal,
});
```

Use `source: "untrusted"` for uploads, unknown URLs, scans, mixed PDFs, and uncertain encodings. Direct arXiv provenance alone does not prove a PDF is native-text. The untrusted route selects the standard detector and returns classification plus `pages[].needsOcr`, `pagesNeedingOcr`, and reason codes. This parser does not perform OCR.

## Output

The returned object includes `text` and `markdown`; page-numbered text and OCR flags; headings with heading level, hierarchy, and page; Markdown tables; text-layer figure/table captions; Markdown-delimited equations; reference entries and citation markers when the formatting rules recognize them; parser text bounding boxes; tagged-PDF semantic roles; PDF type/confidence/OCR metadata; parser path/version/SHA and elapsed times; and an `unrecovered` list describing known gaps.

Example shape (values abbreviated):

```json
{
  "text": "...",
  "markdown": "# Paper title\\n...",
  "pages": [{ "page": 1, "text": "# Paper title\\n...", "needsOcr": false, "ocrReason": null }],
  "headings": [{ "level": 1, "text": "Paper title", "page": 1, "hierarchy": ["Paper title"] }],
  "tables": [{ "page": 4, "markdown": "| ... |\\n| --- |" }],
  "captions": [{ "page": 4, "text": "Figure 1: ..." }],
  "equations": [{ "page": 5, "source": "$$...$$" }],
  "references": [{ "page": 12, "text": "[1] ..." }],
  "citationMarkers": [{ "page": 3, "marker": "[1, 2]" }],
  "coordinates": [{ "text": "...", "page": 1, "bbox": { "x": 72, "y": 700, "width": 120, "height": 10 }, "font": "...", "fontSize": 10 }],
  "taggedStructure": [{ "page": 1, "mcid": 2, "role": "H1" }],
  "classification": { "type": "TextBased", "confidence": 1, "pagesNeedingOcr": [], "reasonsByPage": [] },
  "metadata": { "path": "research-fast-path", "parser": "pdf-inspector", "version": "1.14.2", "parserSha": "6845225...", "durationMs": 84, "parserProcessingMs": 71 },
  "unrecovered": ["OCR is not performed; pages marked needsOcr are returned for an OCR pipeline."]
}
```

The wrapper rejects empty inputs and inputs over 30 MiB, the Rust binding rejects documents over 300 pages before extraction, and each parse is capped at 30 seconds (callers may choose a shorter timeout). A timed-out or aborted parse is killed in a separate Node child process. This keeps native parsing off the web process event loop and makes timeout cancellation real. The child still shares the function/container memory limit, so the Vercel function memory limit remains the hard OOM boundary. The `verified-native` path skips independent pre-classification; trust that source choice, not its resulting `classification.type`, and use the untrusted route whenever the source may contain scanned or mixed pages.

Headings, captions, equations, table blocks, reference entries, and citation markers are derived only from parser output with small format recognizers; they are not semantic extraction guarantees. Figures/image content is not interpreted. Coordinates are PDF points with bottom-left origin and cover text items only. Missing or ambiguous content is not reconstructed; consult `unrecovered` and OCR flags.

## Build and shipping

The package is workspace-discovered by the existing `packages/*` glob. The native crate depends on the vendored Rust crate by path. Build on Linux x64 glibc with Rust 1.98.1, Node 22+, and pnpm 11:

The worker image builds this addon in its `worker-build` stage. That stage installs the pinned Rust toolchain, builds `@learnspace/pdf-parser`, then deploys the worker package with `native/*.node` included. The runtime stage remains Node 22 on Debian bookworm (glibc 2.36); no Rust toolchain is shipped in the worker image.

```bash
rustup toolchain install 1.98.1 --profile minimal --target x86_64-unknown-linux-gnu
pnpm --filter @learnspace/pdf-parser build
pnpm --filter @learnspace/pdf-parser test
```

`build` compiles `native/Cargo.toml` in release mode for `x86_64-unknown-linux-gnu`, copies the result to the `.node` filename, and compiles the TypeScript wrapper. The runtime target is Linux x64 glibc only; the explicit Cargo target prevents another host architecture from being mislabeled as x64.

For the current `learnspace-web-1` dev container (x86_64, Debian glibc 2.36, Node 22.15), Rust is not installed in the container. Build on the host with a Rust toolchain and use the bind-mounted result in the container:

```bash
pnpm --filter @learnspace/pdf-parser build
# Load check against the container's Node and glibc:
docker exec -w /workspace learnspace-web-1 node -e 'require("./packages/pdf-parser/native/learnspace_pdf_parser.linux-x64-gnu.node")'
```

Vercel's build image is Amazon Linux 2023, with gcc available but Rust not listed as preinstalled; its install command can install additional tools. Configure the Vercel **Install Command** to provision rustup and install workspace dependencies, and the **Build Command** to build the native package before the web app:

```bash
# Install Command
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
pnpm install --frozen-lockfile

# Build Command
source "$HOME/.cargo/env" && pnpm --filter @learnspace/pdf-parser build && pnpm --filter @learnspace/web build
```

Select Node.js 22.x or newer in Vercel Project Settings. The `rust-toolchain.toml` pins Rust 1.98.1 and rustup installs that version when Cargo runs. Building at deploy time avoids stale/native ABI artifacts and keeps the `.node` file out of Git, at the cost of a longer build and a network/toolchain installation step. The host build is not used for Vercel shipping; it only tests local loading. If the build image changes architecture/libc, the explicit target should fail rather than silently producing another binary. Set the function memory and duration limits for worst-case research papers; parser-level byte/page/time limits are additional guards. See Vercel's [build image](https://vercel.com/docs/builds/build-image), [custom build configuration](https://vercel.com/docs/builds/configure-a-build), and [Node.js version](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) documentation.

## Benchmark reproduction

The fork docs and vendored tests retain the original five-paper corpus, 3 warm-ups, 24 measured rounds, and output-equivalence checks. Our harness additionally records per-document p50/p95/p99, pages/s, CPU time, peak RSS, and five-paper throughput at concurrency 1/4/8, then checks two survey PDFs, an image-only scan, a two-column fixture, and a truncated PDF.

```bash
python3 docs/benchmarks/pdf-parser/fetch-corpus.py
python3 docs/benchmarks/pdf-parser/run-bench.py --runs 24 --warmups 3
```

The benchmark downloads arXiv PDFs to an ignored local corpus directory and builds both parser revisions in a temporary directory outside the repo. It records the resolved upstream SHA, compiler versions, environment, and dependency-lock hashes; the resolved Cargo locks are saved under `docs/benchmarks/pdf-parser/locks/`. To reproduce an existing result, pass its recorded upstream SHA via `--upstream-ref` instead of `main`:

```bash
python3 docs/benchmarks/pdf-parser/run-bench.py --upstream-ref <sha-from-results> --runs 24 --warmups 3
```

The script writes measurements to `docs/benchmarks/pdf-parser/results/latest.json`. Do not commit fetched PDFs. The results are machine-specific; no performance gain is assumed.
