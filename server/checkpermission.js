import {default as sha256} from 'js-sha256';
import {default as nacl} from 'tweetnacl';
import {default as nearApi} from 'near-api-js';

export const PERMISSION_OWNER = 0x01;
export const PERMISSION_CONTRIBUTOR = 0x02;
export const PERMISSION_READER = 0x04;
export const PERMISSION_FREE = 0x08;

const nearconfig = {
    nodeUrl: 'https://rpc.testnet.near.org',
    walletUrl: 'https://wallet.testnet.near.org',
    helperUrl: 'https://helper.testnet.near.org',
    contractName: 'acl.testnet',
    deps: {
        keyStore: new nearApi.keyStores.UnencryptedFileSystemKeyStore()
    }
};

const permissionCache = {};
const TOKEN_EXPIRY_TIME = 24 * 60 * 60 * 1000;

export async function checkPermission(repository, token) {
    const permissionCacheKey = `${token}_${repository}`;
    const cachedPermission = permissionCache[permissionCacheKey];
    if (cachedPermission) {
        if ((cachedPermission.iat + TOKEN_EXPIRY_TIME) < new Date().getTime()) {
            console.log('token has expired for', cachedPermission.accountId, 'to repository', repository);
            delete permissionCache[permissionCacheKey];
            return { accountId: cachedPermission.accountId, permission: 0 };
        } else {
            return cachedPermission;
        }
    }

    const near = await nearApi.connect(nearconfig);
    
    if (token === 'ANONYMOUS') {   
        const account = await near.account(nearconfig.contractName);
        const contract = new nearApi.Contract(account,
            nearconfig.contractName,
            {
                "viewMethods": ['get_permission']
            });
             
        const permission = await contract.get_permission({account_id: account.accountId, path: repository});
        if (permission === PERMISSION_FREE) {
            console.log('ANONYMOUS read permission granted to repository', repository);
            return { accountId: 'ANONYMOUS', permission: PERMISSION_READER };
        } else {
            console.log('No access for ANONYMOUS to repository', repository);
            return { accountId: 'ANONYMOUS', permission: 0 };
        }
    }

    const tokenparts = token.split('.');
    const msgbytes = Buffer.from(tokenparts[0]);
    const signature  = Buffer.from(tokenparts[1], 'base64');

    const msgobj = JSON.parse(Buffer.from(tokenparts[0], 'base64').toString());

    if (
        (msgobj.iat + TOKEN_EXPIRY_TIME) < new Date().getTime() // check for expiry
        || (msgobj.iat - 1000) > new Date().getTime() // prevent tokens issued for the future
    ) {
        console.log('token issued at', msgobj.iat, 'has expired for', msgobj.accountId, 'to repository', repository);
        return { accountId: msgobj.accountId, permission: 0 };
    }

    const account = await near.account(msgobj.accountId);
    const accesskeys = await account.getAccessKeys();
    
    const publicKeys = accesskeys.map(key =>
        nearApi.utils.PublicKey.fromString(key.public_key)
    );

    const pubkey = publicKeys.find(pk =>
        nacl.sign.detached.verify(new Uint8Array(sha256.array(msgbytes)),
            new Uint8Array(signature), new Uint8Array(pk.data))
    );
    
    if (pubkey) {
        const contract = new nearApi.Contract(account,
            nearconfig.contractName,
            {
                "viewMethods": ['get_permission']
            });
        const permission = await contract.get_permission({account_id: account.accountId, path: repository});
        console.log('permission',permission,'granted for user', account.accountId, 'to repository', repository);

        const result = { accountId: account.accountId, permission: permission, iat: msgobj.iat };
        permissionCache[`${token}_${repository}`] = result;
        return result;
    } else {
        console.log('no permission for user', account.accountId, 'to repository', repository);
        return { accountId: account.accountId, permission: 0 };
    }
}
