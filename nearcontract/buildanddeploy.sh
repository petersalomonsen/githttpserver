#!/bin/bash
set -e
# Build for WebAssembly target
RUSTFLAGS='-C link-arg=-s' cargo build --target=wasm32-unknown-unknown --release
# Remove unneeded WebAssembly exports
mkdir -p out
cp ./target/wasm32-unknown-unknown/release/rust_simple_access_control.wasm out/main.wasm
if [ -z "$1" ]
then
    echo "Deploying to DEV account"
    near dev-deploy out/main.wasm
else
    # Deploy to account given in argument to this script
    echo "Deploying to $1"
    near deploy $1 out/nft.wasm
fi
