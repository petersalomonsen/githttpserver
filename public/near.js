// NEAR sign-in and access tokens.
//
// Sign-in connects a wallet through near-connect (HOT, Meteor, MyNearWallet,
// Intear, ...) and asks it to add a fresh limited access key to the account.
// The private half stays in this browser's localStorage and signs the access
// tokens the git server checks: base64(JSON {accountId, iat}) + '.' +
// base64(ed25519 signature of sha256(that base64 string)), verified against
// the account's on-chain access keys (see server/checkpermission.js).
//
// The key is restricted to the view method `get_permission` on the contract,
// so it cannot move funds or change permissions. Transactions that do need
// the account (set_permission, which carries a deposit) go through the wallet.

import nacl from 'https://cdn.jsdelivr.net/npm/tweetnacl@1.0.3/+esm';

export const CONTRACT_ID = 'wasmgit.near';
const NETWORK = 'mainnet';
const RPC_URL = 'https://rpc.mainnet.fastnear.com';
const KEY_STORAGE = 'githttpserver:near-key';
const ONE_TENTH_NEAR = '100000000000000000000000';
const KEY_ALLOWANCE = '10000000000000000000000'; // 0.01 NEAR

let connectorPromise;
function connector() {
    if (!connectorPromise) {
        connectorPromise = import('https://cdn.jsdelivr.net/npm/@hot-labs/near-connect@0.12.0/+esm')
            .then(({ NearConnector }) => new NearConnector({ network: NETWORK }));
    }
    return connectorPromise;
}

function storedKey() {
    try {
        return JSON.parse(localStorage.getItem(KEY_STORAGE));
    } catch (e) {
        return null;
    }
}

export function currentAccountId() {
    return storedKey()?.accountId ?? null;
}

/**
 * Connect a wallet and register a browser access key for it.
 * @returns {Promise<string>} the signed-in account id
 */
export async function signIn() {
    const nc = await connector();
    const wallet = await nc.connect();
    const accounts = await wallet.getAccounts();
    if (!accounts?.length) throw new Error('the wallet returned no account');
    const accountId = accounts[0].accountId;

    const pair = nacl.sign.keyPair();
    const publicKey = 'ed25519:' + base58(pair.publicKey);
    await wallet.signAndSendTransaction({
        receiverId: accountId,
        actions: [{
            type: 'AddKey',
            params: {
                publicKey,
                accessKey: {
                    permission: {
                        receiverId: CONTRACT_ID,
                        methodNames: ['get_permission'],
                        allowance: KEY_ALLOWANCE,
                    },
                },
            },
        }],
    });
    localStorage.setItem(KEY_STORAGE, JSON.stringify({
        accountId,
        publicKey,
        secretKey: base64(pair.secretKey),
    }));
    return accountId;
}

export async function signOut() {
    localStorage.removeItem(KEY_STORAGE);
    try {
        const nc = await connector();
        await nc.disconnect();
    } catch (e) {
        // not connected through the wallet in this session, nothing to do
    }
}

/** A fresh access token for the git server, or null when signed out. */
export async function createAccessToken() {
    const key = storedKey();
    if (!key) return null;
    const message = btoa(JSON.stringify({ accountId: key.accountId, iat: Date.now() }));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message)));
    const signature = nacl.sign.detached(digest, unbase64(key.secretKey));
    return message + '.' + base64(signature);
}

/** Is the browser key still registered on the account? */
export async function keyIsRegistered() {
    const key = storedKey();
    if (!key) return false;
    try {
        await rpc('query', {
            request_type: 'view_access_key',
            finality: 'final',
            account_id: key.accountId,
            public_key: key.publicKey,
        });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Set an account's permission on a repository. Paid through the wallet
 * (0.1 NEAR deposit). permission: 'owner' | 'contributor' | 'reader' | 'none'.
 */
export async function setPermission(repository, permission, accountId) {
    const permissionmap = { none: 0x00, owner: 0x01, contributor: 0x02, reader: 0x04 };
    if (!(permission in permissionmap)) throw new Error(`unknown permission ${permission}`);
    const nc = await connector();
    const wallet = await nc.wallet().catch(() => nc.connect());
    return await wallet.signAndSendTransaction({
        receiverId: CONTRACT_ID,
        actions: [{
            type: 'FunctionCall',
            params: {
                methodName: 'set_permission',
                args: {
                    account_id: accountId || currentAccountId(),
                    path: repository,
                    permission: permissionmap[permission],
                },
                gas: '30000000000000',
                deposit: ONE_TENTH_NEAR,
            },
        }],
    });
}

/** The permission bitmask an account has on a repository (view call, no wallet). */
export async function getPermission(repository, accountId) {
    const args = btoa(JSON.stringify({ account_id: accountId, path: repository }));
    const result = await rpc('query', {
        request_type: 'call_function',
        finality: 'final',
        account_id: CONTRACT_ID,
        method_name: 'get_permission',
        args_base64: args,
    });
    return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result)));
}

async function rpc(method, params) {
    const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'githttpserver', method, params }),
    });
    const json = await response.json();
    if (json.error) throw new Error(json.error.cause?.name || json.error.message || 'rpc error');
    if (json.result?.error) throw new Error(json.result.error);
    return json.result;
}

function base64(bytes) {
    return btoa(String.fromCharCode(...bytes));
}

function unbase64(text) {
    return Uint8Array.from(atob(text), c => c.charCodeAt(0));
}

function base58(bytes) {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let num = 0n;
    for (const b of bytes) num = num * 256n + BigInt(b);
    let result = '';
    while (num > 0n) {
        result = ALPHABET[Number(num % 58n)] + result;
        num /= 58n;
    }
    for (const b of bytes) {
        if (b !== 0) break;
        result = '1' + result;
    }
    return result;
}
