#!/bin/bash
set -e
# Build for WebAssembly target
RUSTFLAGS='-C link-arg=-s' cargo build --target=wasm32-unknown-unknown --release
# Remove unneeded WebAssembly exports
mkdir -p out
cp ./target/wasm32-unknown-unknown/release/rust_simple_access_control.wasm out/main.wasm
echo "Deploying to DEV account"
near dev-deploy out/main.wasm
near call `cat neardev/dev-account` --accountId=`cat neardev/dev-account` init

