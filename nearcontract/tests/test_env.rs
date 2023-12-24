use near_units::parse_near;
use near_workspaces::{AccountId, types::NearToken};
use serde_json::json;

const WASMGIT_CONTRACT: &str = "wasmgit.near";

pub async fn init_contracts() -> anyhow::Result<near_workspaces::Contract> {
    let worker = near_workspaces::sandbox().await?;
    let mainnet = near_workspaces::mainnet_archival().await?;

    let contract_id: AccountId = WASMGIT_CONTRACT.parse()?;
    let contract = worker
        .import_contract(&contract_id, &mainnet)
        .initial_balance(NearToken::from_near(1000))
        .transact()
        .await?;

    Ok(contract)
}