use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::{env, near_bindgen, PanicOnDefault};
use std::collections::HashMap;

pub type Permission = u32;
const PERMISSION_OWNER: Permission = 0x01; // Can create
const PERMISSION_CONTRIBUTOR: Permission = 0x02;
const PERMISSION_READER: Permission = 0x04;
const PERMISSION_FREE: Permission = 0x08;
static EVERYONE: &str = "EVERYONE";
const REPOSITORY_PERMISSION_KEY: &[u8] = b"rp";

#[near_bindgen]
#[derive(PanicOnDefault, BorshDeserialize, BorshSerialize)]
pub struct RepositoryPermission {
    permission: HashMap<String, HashMap<String, Permission>>,
}

#[near_bindgen]
#[derive(PanicOnDefault, BorshDeserialize, BorshSerialize)]
pub struct Contract {
    permission: LookupMap<String, HashMap<String, Permission>>
}

#[near_bindgen]
impl Contract {
    #[init(ignore_state)]
    pub fn init() -> Self {
        let mut contract = Self {
            permission: LookupMap::new(REPOSITORY_PERMISSION_KEY.to_vec()),
        };

        let old_state = env::state_read();
        if old_state.is_some() {
            let old_state_value: RepositoryPermission =
                old_state.unwrap_or_else(|| panic!("nothing to migrate"));
            for (key, value) in old_state_value.permission {
                contract.permission.insert(&key, &value);
            }
        }

        contract
    }

    #[payable]
    pub fn set_permission(
        &mut self,
        path: String,
        account_id: String,
        permission: Permission,
    ) -> bool {
        assert_eq!(
            10u128.pow(23),
            env::attached_deposit(),
            "requires attached deposit of 0.1N"
        );

        let caller_account_id = env::signer_account_id();
        let current_permission =
            self.get_permission(caller_account_id.to_string(), path.to_string());
        if current_permission & (PERMISSION_OWNER) > 0 {
            let mut path_users = self.permission.get(&path.to_string()).unwrap().clone();
            path_users.insert(account_id, permission);
            self.permission.insert(&path.to_string(), &path_users);
            return true;
        } else if current_permission & (PERMISSION_FREE) > 0 {
            let mut path_users: HashMap<String, Permission> = HashMap::new();
            path_users.insert(account_id, permission);
            self.permission.insert(&path.to_string(), &path_users);
            return true;
        } else {
            panic!("permission denied");
        }
    }

    pub fn get_permission(&self, account_id: String, path: String) -> Permission {
        let path_users = self.permission.get(&path.to_string());
        if path_users.is_some() {
            let path_users_unwrapped = path_users.unwrap();
            let permission = path_users_unwrapped.get(&account_id);
            if permission.is_some() {
                return *permission.unwrap();
            } else {
                let everyone_permission = path_users_unwrapped.get(EVERYONE);
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
    use std::convert::TryInto;

    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env, VMContext};

    const REQUIRED_ATTACHED_DEPOSIT: u128 = 100000000000000000000000;

    // part of writing unit tests is setting up a mock context
    // in this example, this is only needed for env::log in the contract
    fn get_context(
        signer_account_id: String,
        is_view: bool,
        attached_deposit: u128,
    ) -> VMContext {
        VMContextBuilder::new()
            .signer_account_id(signer_account_id.parse().unwrap())
            .current_account_id("alice_near".parse().unwrap())
            .predecessor_account_id("jane_near".parse().unwrap())
            .attached_deposit(attached_deposit)
            .signer_account_pk(
                vec![
                    00, 66, 211, 21, 84, 20, 241, 129, 29, 118, 83, 184, 41, 215, 240, 117, 106,
                    56, 29, 69, 103, 43, 191, 167, 199, 102, 3, 16, 194, 250, 138, 198, 78,
                ]
                .try_into()
                .unwrap(),
            )
            .is_view(is_view)
            .build()
    }

    #[test]
    fn set_get_permission() {
        let context = get_context(
            "peter".to_string(),
            false,
            REQUIRED_ATTACHED_DEPOSIT,
        );
        testing_env!(context);
        let mut contract = Contract::init();
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
            false,
            REQUIRED_ATTACHED_DEPOSIT,
        );
        testing_env!(context);
        let mut contract = Contract::init();
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

        let context2 = get_context("peter".to_string(), false, 0);
        testing_env!(context2);

        assert_eq!(
            PERMISSION_CONTRIBUTOR,
            contract.get_permission("peter".to_string(), "testrepo".to_string())
        );

        let context3 = get_context("johan".to_string(), false, 0);
        testing_env!(context3);

        assert_eq!(
            PERMISSION_OWNER,
            contract.get_permission("johan".to_string(), "testrepo".to_string())
        );
    }

    #[test]
    fn deny_set_permission() {
        let context = get_context(
            "johan".to_string(),
            false,
            REQUIRED_ATTACHED_DEPOSIT,
        );
        testing_env!(context);
        let mut contract: Contract = Contract::init();
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

        testing_env!(get_context(
            "someotheruser".to_string(),
            false,
            REQUIRED_ATTACHED_DEPOSIT,
        ));

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.set_permission(
                "testrepo".to_string(),
                "someotheruser".to_string(),
                PERMISSION_OWNER,
            );
        }));

        assert!(result.is_err());
    }

    #[test]
    fn read_permission_for_everyone() {
        let context = get_context(
            "peter".to_string(),
            false,
            REQUIRED_ATTACHED_DEPOSIT,
        );
        testing_env!(context);
        let mut contract = Contract::init();
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
            false,
            REQUIRED_ATTACHED_DEPOSIT,
        );
        testing_env!(context);
        let mut contract = Contract::init();
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
        let context = get_context("peter".to_string(), false, 2);
        testing_env!(context);
        let mut contract = Contract::init();

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            return contract.set_permission(
                "testrepo".to_string(),
                "peter".to_string(),
                PERMISSION_OWNER,
            );
        }));
        assert!(result.is_err());
    }
}
