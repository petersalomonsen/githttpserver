pub async fn init_contracts() -> anyhow::Result<near_workspaces::Contract> {
    let worker = near_workspaces::sandbox().await?;
    let wasm = std::fs::read("./out/main.wasm")
        .expect("Contract WASM not found. Run ./build.sh first.");
    let contract = worker.dev_deploy(&wasm).await?;

    Ok(contract)
}