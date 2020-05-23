test:

`cargo test --package rust-simple-access-control -- --nocapture`

build:

`env 'RUSTFLAGS=-C link-arg=-s' cargo build --target wasm32-unknown-unknown --release`
