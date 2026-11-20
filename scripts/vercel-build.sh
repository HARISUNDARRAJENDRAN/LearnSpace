#!/bin/sh
# Vercel's build command. The web app parses papers with the worker's PDF parser, a native Rust module built from source
# here, and Vercel's build image has no Rust; packages/pdf-parser/rust-toolchain.toml picks the toolchain.
set -eu
if ! command -v cargo >/dev/null 2>&1 && [ ! -x "$HOME/.cargo/bin/cargo" ]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
fi
export PATH="$HOME/.cargo/bin:$PATH"
pnpm turbo run build --filter=@learnspace/web
test -s packages/pdf-parser/native/learnspace_pdf_parser.linux-x64-gnu.node
