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

    let contract_deploy_result = contract.as_account().deploy(wasm.as_slice()).await?;
    assert!(contract_deploy_result.is_success());

    let initialize_result = contract.call("init").transact().await?;
    assert!(initialize_result.is_success());

    let get_permission_after_upgrade_result: serde_json::Value = contract
        .call("get_permission")
        .args_json(json!({
            "path": "test",
            "account_id": "peter"
        }))
        .view()
        .await?
        .json()?;

    assert_eq!(1, get_permission_after_upgrade_result);

    let second_initialize_result = contract.call("init").transact().await?;
    assert!(second_initialize_result.is_failure());

    let get_permission_after_second_upgrade_result: serde_json::Value = contract
        .call("get_permission")
        .args_json(json!({
            "path": "test",
            "account_id": "peter"
        }))
        .view()
        .await?
        .json()?;

    assert_eq!(1, get_permission_after_second_upgrade_result);
    Ok(())
}
