use borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::{env, near_bindgen};
use std::collections::HashMap;

#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

const PERMISSION_OWNER: u32 = 0x01; // Can create
const PERMISSION_CONTRIBUTOR: u32 = 0x02;
const PERMISSION_READER: u32 = 0x04;
const PERMISSION_FREE: u32 = 0x08;
static EVERYONE: &str = "EVERYONE";

// add the following attributes to prepare your code for serialization and invocation on the blockchain
// More built-in Rust attributes here: https://doc.rust-lang.org/reference/attributes.html#built-in-attributes-index
#[near_bindgen]
#[derive(Default, BorshDeserialize, BorshSerialize)]
pub struct RepositoryPermission {
    permission: HashMap<String, HashMap<String, u32>>,
}

#[near_bindgen]
impl RepositoryPermission {
    #[payable]
    pub fn set_permission(&mut self, path: String, account_id: String, permission: u32) -> bool {
        assert_eq!(
            10u128.pow(23),
            env::attached_deposit(),
            "requires attached deposit of 0.1N"
        );

        let caller_account_id = env::signer_account_id();
        let current_permission = self.get_permission(caller_account_id, path.to_string());
        if current_permission & (PERMISSION_OWNER) > 0 {
            let mut path_users = self.permission.get(&path.to_string()).unwrap().clone();
            path_users.insert(account_id, permission);
            self.permission.insert(path.to_string(), path_users);
            return true;
        } else if current_permission & (PERMISSION_FREE) > 0 {
            let mut path_users: HashMap<String, u32> = HashMap::new();
            path_users.insert(account_id, permission);
            self.permission.insert(path.to_string(), path_users);
            return true;
        } else {
            return false;
        }
    }

    pub fn get_permission(&self, account_id: String, path: String) -> u32 {
        let path_users = self.permission.get(&path.to_string());
        if path_users.is_some() {
            let permission = path_users.unwrap().get(&account_id);
            if permission.is_some() {
                return *permission.unwrap();
            } else {
                let everyone_permission = path_users.unwrap().get(EVERYONE);
                return if everyone_permission.is_some() {
                    *everyone_permission.unwrap()
                } else {
                    0
                };
            }
        } else {
            return PERMISSION_FREE;
        }
    }
}

/*
 * the rest of this file sets up unit tests
 * to run these, the command will be:
 * cargo test --package rust-counter-tutorial -- --nocapture
 * Note: 'rust-counter-tutorial' comes from cargo.toml's 'name' key
 */

// use the attribute below for unit tests
#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::MockedBlockchain;
    use near_sdk::{testing_env, VMContext};

    const REQUIRED_ATTACHED_DEPOSIT: u128 = 100000000000000000000000;

    // part of writing unit tests is setting up a mock context
    // in this example, this is only needed for env::log in the contract
    fn get_context(
        signer_account_id: String,
        input: Vec<u8>,
        is_view: bool,
        attached_deposit: u128,
    ) -> VMContext {
        VMContext {
            epoch_height: 0,
            current_account_id: "alice_near".to_string(),
            signer_account_id: signer_account_id.to_string(),
            signer_account_pk: vec![0, 1, 2],
            predecessor_account_id: "jane_near".to_string(),
            input,
            block_index: 0,
            block_timestamp: 0,
            account_balance: 0,
            account_locked_balance: 0,
            storage_usage: 0,
            attached_deposit: attached_deposit,
            prepaid_gas: 10u64.pow(18),
            random_seed: vec![0, 1, 2],
            is_view,
            output_data_receivers: vec![],
        }
    }

    #[test]
    fn set_get_permission() {
        let context = get_context(
            "peter".to_string(),
            vec![],
            false,
            REQUIRED_ATTACHED_DEPOSIT,
        );
        testing_env!(context);
        let mut contract = RepositoryPermission::default();
        assert_eq!(
            PERMISSION_FREE,
            contract.get_permission("peter".to_string(), "testrepo".to_string())
        );
        assert_eq!(
            true,
            contract.set_permission(
                "testrepo".to_string(),
                "peter".to_string(),
                PERMISSION_OWNER
            )
        );
        assert_eq!(
            PERMISSION_OWNER,
            contract.get_permission("peter".to_string(), "testrepo".to_string())
        );
    }

    #[test]
    fn set_get_permission_different_context() {
        let context = get_context(
            "johan".to_string(),
            vec![],
            false,
            REQUIRED_ATTACHED_DEPOSIT,
        );
        testing_env!(context);
        let mut contract = RepositoryPermission::default();
        assert_eq!(
            PERMISSION_FREE,
            contract.get_permission("johan".to_string(), "testrepo".to_string())
        );
        assert_eq!(
            true,
            contract.set_permission(
                "testrepo".to_string(),
                "johan".to_string(),
                PERMISSION_OWNER
            )
        );
        assert_eq!(
            true,
            contract.set_permission(
                "testrepo".to_string(),
                "peter".to_string(),
                PERMISSION_CONTRIBUTOR
            )
        );

        let context2 = get_context("peter".to_string(), vec![], false, 0);
        testing_env!(context2);

        assert_eq!(
            PERMISSION_CONTRIBUTOR,
            contract.get_permission("peter".to_string(), "testrepo".to_string())
        );

        let context3 = get_context("johan".to_string(), vec![], false, 0);
        testing_env!(context3);

        assert_eq!(
            PERMISSION_OWNER,
            contract.get_permission("johan".to_string(), "testrepo".to_string())
        );
    }

    #[test]
    fn read_permission_for_everyone() {
        let context = get_context(
            "peter".to_string(),
            vec![],
            false,
            REQUIRED_ATTACHED_DEPOSIT,
        );
        testing_env!(context);
        let mut contract = RepositoryPermission::default();
        assert_eq!(
            PERMISSION_FREE,
            contract.get_permission("peter".to_string(), "testrepo".to_string())
        );
        assert_eq!(
            true,
            contract.set_permission(
                "testrepo".to_string(),
                "peter".to_string(),
                PERMISSION_OWNER
            )
        );
        assert_eq!(
            PERMISSION_OWNER,
            contract.get_permission("peter".to_string(), "testrepo".to_string())
        );

        assert_eq!(
            true,
            contract.set_permission(
                "testrepo".to_string(),
                EVERYONE.to_string(),
                PERMISSION_READER
            )
        );
        assert_eq!(
            PERMISSION_READER,
            contract.get_permission(EVERYONE.to_string(), "testrepo".to_string())
        );
        assert_eq!(
            PERMISSION_READER,
            contract.get_permission("randomuser".to_string(), "testrepo".to_string())
        );
    }

    #[test]
    fn write_permission_for_everyone_read_for_anonymous() {
        let context = get_context(
            "peter".to_string(),
            vec![],
            false,
            REQUIRED_ATTACHED_DEPOSIT,
        );
        testing_env!(context);
        let mut contract = RepositoryPermission::default();
        assert_eq!(
            PERMISSION_FREE,
            contract.get_permission("peter".to_string(), "testrepo".to_string())
        );
        assert_eq!(
            true,
            contract.set_permission(
                "testrepo".to_string(),
                "peter".to_string(),
                PERMISSION_OWNER
            )
        );
        assert_eq!(
            PERMISSION_OWNER,
            contract.get_permission("peter".to_string(), "testrepo".to_string())
        );

        assert_eq!(
            true,
            contract.set_permission(
                "testrepo".to_string(),
                EVERYONE.to_string(),
                PERMISSION_CONTRIBUTOR
            )
        );
        assert_eq!(
            true,
            contract.set_permission(
                "testrepo".to_string(),
                "ANONYMOUS".to_string(),
                PERMISSION_READER
            )
        );

        assert_eq!(
            PERMISSION_CONTRIBUTOR,
            contract.get_permission(EVERYONE.to_string(), "testrepo".to_string())
        );
        assert_eq!(
            PERMISSION_CONTRIBUTOR,
            contract.get_permission("ANNONYMOUS".to_string(), "testrepo".to_string())
        );
        assert_eq!(
            PERMISSION_READER,
            contract.get_permission("ANONYMOUS".to_string(), "testrepo".to_string())
        );
    }

    #[test]
    fn require_attached_deposits() {
        let context = get_context("peter".to_string(), vec![], false, 2);
        testing_env!(context);

        let result = std::panic::catch_unwind(|| {
            let mut contract = RepositoryPermission::default();
            return contract.set_permission(
                "testrepo".to_string(),
                "peter".to_string(),
                PERMISSION_OWNER,
            );
        });
        assert!(result.is_err());
    }
}
