#!/bin/bash
set -e
# Build for WebAssembly target using cargo-near
cargo near build non-reproducible-wasm --no-doc
# Copy to expected location
mkdir -p out
cp ./target/near/*.wasm out/main.wasm
echo "Contract built successfully"

