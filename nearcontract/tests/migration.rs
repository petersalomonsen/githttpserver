use near_workspaces::types::NearToken;

mod test_env;

use {crate::test_env::*, serde_json::json};

#[tokio::test]
async fn test_deploy_contract_self_upgrade() -> anyhow::Result<()> {
    let contract = init_contracts().await?;
    let set_permission_result = contract
        .call("set_permission")
        .args_json(json!({
            "path": "test",
            "account_id": "peter",
            "permission": 0x01
        }))
        .deposit(NearToken::from_millinear(100))
        .transact()
        .await?;
    assert!(set_permission_result.is_success());

    let get_permission_result: serde_json::Value = contract
        .call("get_permission")
        .args_json(json!({
            "path": "test",
            "account_id": "peter"
        }))
        .view()
        .await?
        .json()?;

    assert_eq!(1, get_permission_result);

    let wasm = near_workspaces::compile_project("./").await?;

    let mut contract_upgrade_result = contract
        .call("unsafe_self_upgrade")
        .args(wasm)
        .max_gas()
        .transact()
        .await?;

    Ok(())
}
