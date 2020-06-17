Simple near-protocol Smart Contract for Access Control
======================================================

# Set permission for a repository (path)

Using near-cli:

`near call acl.testnet set_permission --accountId myaccountid.testnet '{"path": "myrepositorypath", "account_id": "myaccountid.testnet", "permission": 1}'`

For creating a repository you need to have the owner permission, see [lib.rs](src/lib.rs) for a list of permission bit values.

In order to set permissions for a repository you need to be owner, or the repository must be free (`PERMISSION_FREE = 0x08`).

# View an accounts permission to a repository

Using near-cli:

`near view acl.testnet get_permission '{"account_id": "myaccountid.testnet", "path": "myrepositorypath"}'`

# Building

test:

`cargo test --package rust-simple-access-control -- --nocapture`

build:

`env 'RUSTFLAGS=-C link-arg=-s' cargo build --target wasm32-unknown-unknown --release`

deploy:

`near deploy --wasmFile target/wasm32-unknown-unknown/release/rust_simple_access_control.wasm --accountId acl.testnet`