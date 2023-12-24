mod test_env;

use {crate::test_env::*, serde_json::json};

#[tokio::test]
async fn test_deploy_contract_self_upgrade() -> anyhow::Result<()> {
    let contract = init_contracts().await?;
    let wasm = near_workspaces::compile_project("./").await?;

    let mut contract_upgrade_result =
        contract.call("unsafe_self_upgrade").args(wasm).max_gas().transact().await?;

    Ok(())
}