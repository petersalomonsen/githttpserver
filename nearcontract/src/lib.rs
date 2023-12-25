use byteorder::{BigEndian, ReadBytesExt, WriteBytesExt};
use ed25519_dalek::PublicKey as DalekPK;
use ed25519_dalek::Signature as DalekSig;
use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::PublicKey;
use near_sdk::{base64, env, near_bindgen, PanicOnDefault};
use std::collections::HashMap;

pub type Permission = u32;
const PERMISSION_OWNER: Permission = 0x01; // Can create
const PERMISSION_CONTRIBUTOR: Permission = 0x02;
const PERMISSION_READER: Permission = 0x04;
const PERMISSION_FREE: Permission = 0x08;
static EVERYONE: &str = "EVERYONE";
pub type InvitationId = u64;

const INVITATIONS_KEY: &[u8] = b"INVITATIONS";
const INVITATION_ID_KEY: &[u8] = b"INVITATION_ID";
const REPOSITORY_PERMISSION_KEY: &[u8] = b"rp";

#[derive(BorshDeserialize, BorshSerialize)]
pub struct Invitation {
    path: String,
    permission: Permission,
    signingkey: PublicKey,
}

#[derive(PanicOnDefault, BorshDeserialize, BorshSerialize)]
pub struct Invitations {
    invitations: HashMap<InvitationId, Invitation>,
}

#[near_bindgen]
#[derive(PanicOnDefault, BorshDeserialize, BorshSerialize)]
pub struct RepositoryPermission {
    permission: HashMap<String, HashMap<String, Permission>>,
}

#[near_bindgen]
#[derive(PanicOnDefault, BorshDeserialize, BorshSerialize)]
pub struct Contract {
    permission: LookupMap<String, HashMap<String, Permission>>,
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

    fn load_invitations(&self) -> Invitations {
        return env::storage_read(INVITATIONS_KEY)
            .map(|data| {
                Invitations::try_from_slice(&data).expect("Cannot deserialize the invitations.")
            })
            .unwrap_or_default();
    }

    fn save_invitations(&self, invitations: Invitations) {
        env::storage_write(
            INVITATIONS_KEY,
            &invitations
                .try_to_vec()
                .expect("Cannot serialize invitations."),
        );
    }

    pub fn invite(&mut self, path: String, permission: Permission) -> u64 {
        let mut invitations = self.load_invitations();

        let invitationidbuf = env::storage_read(INVITATION_ID_KEY);
        let invitationid = if invitationidbuf.is_some() {
            invitationidbuf
                .unwrap()
                .as_slice()
                .read_u64::<BigEndian>()
                .unwrap()
        } else {
            1
        };

        let caller_account_id = env::signer_account_id();
        if self.get_permission(caller_account_id.to_string(), path.to_string()) == PERMISSION_OWNER
        {
            invitations.invitations.insert(
                invitationid,
                Invitation {
                    permission: permission,
                    path: path,
                    signingkey: env::signer_account_pk(),
                },
            );
            self.save_invitations(invitations);
            let mut wtr = vec![];
            wtr.write_u64::<BigEndian>(invitationid + 1).unwrap();
            env::storage_write(INVITATION_ID_KEY, wtr.as_slice());
            return invitationid;
        } else {
            panic!("You are not the owner of the path");
        }
    }

    pub fn redeem_invitation(&mut self, invitationid: InvitationId, signature: String) -> bool {
        let caller_account_id = env::signer_account_id();
        let mut invitations = self.load_invitations();
        let invitation = invitations.invitations.get(&invitationid).unwrap();

        let pk = DalekPK::from_bytes(&invitation.signingkey.as_bytes()[1..].to_vec()).unwrap();
        let sig = DalekSig::from_bytes(base64::decode(&signature).unwrap().as_slice()).unwrap();

        let signedmessage = format!("invitation{}", invitationid);

        if !pk.verify_strict(signedmessage.as_bytes(), &sig).is_ok() {
            panic!("Invalid signature");
        }

        let mut path_users = self.permission.get(&invitation.path).unwrap().clone();
        path_users.insert(caller_account_id.to_string(), invitation.permission);
        self.permission
            .insert(&invitation.path.to_string(), &path_users);

        invitations.invitations.remove(&invitationid);
        self.save_invitations(invitations);
        return true;
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
    const INVITATION_SIGNATURE: &str =
        "LtXiPcOxOC8n5/qiICscp3P5Ku8ymC3gj1eYJuq8GFR9co2pZYwbWLBiu5CrtVFtvmeWwMzOIkp4tJaosJ40Dg==";

    // part of writing unit tests is setting up a mock context
    // in this example, this is only needed for env::log in the contract
    fn get_context(
        signer_account_id: String,
        input: Vec<u8>,
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
            vec![],
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
            vec![],
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
    fn deny_set_permission() {
        let context = get_context(
            "johan".to_string(),
            vec![],
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
            vec![],
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
            vec![],
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
            vec![],
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
        let context = get_context("peter".to_string(), vec![], false, 2);
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

    #[test]
    fn invite_and_redeem_invitation() {
        testing_env!(get_context(
            "peter".to_string(),
            vec![],
            false,
            REQUIRED_ATTACHED_DEPOSIT
        ));
        let mut contract = Contract::init();
        let path = "lalala";
        contract.set_permission(path.to_string(), "peter".to_string(), PERMISSION_OWNER);
        let invitationid = contract.invite(path.to_string(), PERMISSION_READER);
        contract.redeem_invitation(invitationid, INVITATION_SIGNATURE.to_string());
        assert_eq!(
            PERMISSION_READER,
            contract.get_permission("peter".to_string(), path.to_string())
        );
    }

    #[test]
    fn invite_without_ownership() {
        let context = get_context(
            "peter".to_string(),
            vec![],
            false,
            REQUIRED_ATTACHED_DEPOSIT,
        );
        testing_env!(context);
        let mut contract = Contract::init();
        let path = "lalala";
        contract.set_permission(
            path.to_string(),
            "peter".to_string(),
            PERMISSION_CONTRIBUTOR,
        );

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            return contract.invite(path.to_string(), PERMISSION_READER);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn invite_invalid_signature() {
        let context = get_context(
            "peter".to_string(),
            vec![],
            false,
            REQUIRED_ATTACHED_DEPOSIT,
        );
        testing_env!(context);
        let mut contract = Contract::init();
        let path = "lalala";
        contract.set_permission(path.to_string(), "peter".to_string(), PERMISSION_OWNER);
        let invitationid = contract.invite(path.to_string(), PERMISSION_READER);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            return contract.redeem_invitation(
                invitationid,
                "903zZRlh45/KFMoFbpljVffajuNPeEB7J0PLJ7XylcvxdAJ+imQn0vGv9Tp4H/moqr5xJk+jItCv4JAIc/vQBA==".to_string()
            );
        }));
        assert!(result.is_err());
    }

    #[test]
    fn invite_and_redeem_invitation_twice() {
        let context = get_context(
            "peter".to_string(),
            vec![],
            false,
            REQUIRED_ATTACHED_DEPOSIT,
        );
        testing_env!(context);
        let mut contract = Contract::init();
        let path = "lalala";
        contract.set_permission(path.to_string(), "peter".to_string(), PERMISSION_OWNER);
        let invitationid = contract.invite(path.to_string(), PERMISSION_READER);

        contract.redeem_invitation(invitationid, INVITATION_SIGNATURE.to_string());
        assert_eq!(
            PERMISSION_READER,
            contract.get_permission("peter".to_string(), path.to_string())
        );

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.redeem_invitation(invitationid, INVITATION_SIGNATURE.to_string());
        }));
        assert!(result.is_err());
    }
    #[test]
    fn invite_and_redeem_invitation_old_signature() {
        let context = get_context(
            "peter".to_string(),
            vec![],
            false,
            REQUIRED_ATTACHED_DEPOSIT,
        );
        testing_env!(context);
        let mut contract = Contract::init();
        let mut path = "lalala";
        contract.set_permission(path.to_string(), "peter".to_string(), PERMISSION_OWNER);
        let mut invitationid = contract.invite(path.to_string(), PERMISSION_READER);

        contract.redeem_invitation(invitationid, INVITATION_SIGNATURE.to_string());
        assert_eq!(
            PERMISSION_READER,
            contract.get_permission("peter".to_string(), path.to_string())
        );

        path = "abc";
        contract.set_permission(path.to_string(), "peter".to_string(), PERMISSION_OWNER);
        invitationid = contract.invite(path.to_string(), PERMISSION_READER);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.redeem_invitation(invitationid, INVITATION_SIGNATURE.to_string());
        }));
        assert!(result.is_err());

        contract.redeem_invitation(
            invitationid,
            "903zZRlh45/KFMoFbpljVffajuNPeEB7J0PLJ7XylcvxdAJ+imQn0vGv9Tp4H/moqr5xJk+jItCv4JAIc/vQBA==".to_string()
        );

        assert_eq!(
            PERMISSION_READER,
            contract.get_permission("peter".to_string(), path.to_string())
        );
    }
}
