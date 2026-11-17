#!/usr/bin/env python3
"""Fetch pinned arXiv PDFs and prepare the local edge-case corpus."""
from pathlib import Path
import argparse
import shutil
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUT = Path(__file__).resolve().parent / "corpus"
PAPERS = {
    "1706.03762v7": "Attention Is All You Need (two-column, math-heavy)",
    "1810.04805v2": "BERT",
    "2005.14165v4": "Language Models are Few-Shot Learners",
    "2010.11929v2": "An Image is Worth 16x16 Words",
    "2006.11239v2": "Denoising Diffusion Probabilistic Models",
    "2401.02954v1": "Survey with a large reference section",
    "2307.09288v1": "Long survey paper",
}


def fetch(arxiv_id: str, path: Path) -> None:
    request = urllib.request.Request(f"https://arxiv.org/pdf/{arxiv_id}", headers={"User-Agent": "LearnSpace/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response, path.open("wb") as output:
        shutil.copyfileobj(response, output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for arxiv_id, _ in PAPERS.items():
        path = args.out / f"{arxiv_id}.pdf"
        if not path.exists():
            fetch(arxiv_id, path)
    fixture = ROOT / "vendor/pdf-inspector-researchpapers/tests/fixtures"
    shutil.copyfile(fixture / "scan_with_native_header_text.pdf", args.out / "image-only-scan.pdf")
    shutil.copyfile(fixture / "wireless_two_col_no_rects.pdf", args.out / "two-column-fixture.pdf")
    source = args.out / "1706.03762v7.pdf"
    (args.out / "truncated.pdf").write_bytes(source.read_bytes()[:-256])


if __name__ == "__main__":
    main()
