#!/bin/bash
set -e
# Build for WebAssembly target using regular cargo build (skip wasm-opt step that fails)
RUSTFLAGS='-C link-arg=-s' cargo build --target=wasm32-unknown-unknown --release
# Copy to expected location
mkdir -p out
cp ./target/wasm32-unknown-unknown/release/rust_simple_access_control.wasm out/main.wasm
echo "Contract built successfully"

