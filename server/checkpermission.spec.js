import { checkPermission, PERMISSION_READER, PERMISSION_CONTRIBUTOR, PERMISSION_OWNER, use_sandbox } from './checkpermission.js';
import { default as nacl } from 'tweetnacl';
import { default as sha256 } from 'js-sha256';
import * as assert from 'assert';
import { readFileSync } from 'fs';
import { Sandbox, DEFAULT_PRIVATE_KEY, DEFAULT_PUBLIC_KEY } from 'near-sandbox';
import { KeyPair, transactions, utils } from 'near-api-js';
import crypto from 'crypto';
import {
    NearRpcClient,
    broadcastTxCommit,
    viewAccessKey,
    block
} from '@near-js/jsonrpc-client';

let sandbox;
let sandboxRpcClient;
let rootKeyPair;
let contractAccountId;
let contractKeyPair;
const reponame = 'test2';
const accountKeys = new Map();

async function getLatestBlockHash() {
    const result = await block(sandboxRpcClient, { finality: 'final' });
    return result.header.hash;
}

async function getAccessKeyNonce(accountId, publicKey) {
    const result = await viewAccessKey(sandboxRpcClient, {
        accountId,
        publicKey,
        finality: 'final',
    });
    return result.nonce;
}

async function createAccount(accountId, initialBalance = '100000000000000000000000000') {
    const newKeyPair = KeyPair.fromRandom('ed25519');
    accountKeys.set(accountId, newKeyPair);

    const actions = [
        transactions.createAccount(),
        transactions.transfer(BigInt(initialBalance)),
        transactions.addKey(newKeyPair.getPublicKey(), transactions.fullAccessKey()),
    ];

    const blockHash = await getLatestBlockHash();
    const parentAccount = accountId.endsWith('test.near') ? 'test.near' : 'near';
    const nonce = await getAccessKeyNonce(parentAccount, rootKeyPair.getPublicKey().toString());

    const tx = transactions.createTransaction(
        parentAccount,
        rootKeyPair.getPublicKey(),
        accountId,
        nonce + 1,
        actions,
        utils.serialize.base_decode(blockHash)
    );

    const serializedTx = utils.serialize.serialize(transactions.SCHEMA.Transaction, tx);
    const txHash = crypto.createHash('sha256').update(serializedTx).digest();
    const signature = rootKeyPair.sign(txHash);

    const signedTx = new transactions.SignedTransaction({
        transaction: tx,
        signature: new transactions.Signature({
            keyType: tx.publicKey.keyType,
            data: signature.signature,
        }),
    });

    const signedTxBytes = signedTx.encode();
    const signedTxBase64 = Buffer.from(signedTxBytes).toString('base64');
    const result = await broadcastTxCommit(sandboxRpcClient, {
        signedTxBase64: signedTxBase64,
        waitUntil: 'FINAL',
    });

    if (result.status.Failure) {
        throw new Error(`Failed to create account: ${accountId}`);
    }

    return newKeyPair;
}

async function deployContract(accountId, wasmCode) {
    const keyPair = accountKeys.get(accountId);
    if (!keyPair) throw new Error(`No key for account ${accountId}`);

    const actions = [transactions.deployContract(wasmCode)];

    const blockHash = await getLatestBlockHash();
    await new Promise((resolve) => setTimeout(() => resolve(), 2000));
    const nonce = await getAccessKeyNonce(accountId, keyPair.getPublicKey().toString());

    const tx = transactions.createTransaction(
        accountId,
        keyPair.getPublicKey(),
        accountId,
        nonce + 1,
        actions,
        utils.serialize.base_decode(blockHash)
    );

    const serializedTx = utils.serialize.serialize(transactions.SCHEMA.Transaction, tx);
    const txHash = crypto.createHash('sha256').update(serializedTx).digest();
    const signature = keyPair.sign(txHash);

    const signedTx = new transactions.SignedTransaction({
        transaction: tx,
        signature: new transactions.Signature({
            keyType: tx.publicKey.keyType,
            data: signature.signature,
        }),
    });

    const signedTxBytes = signedTx.encode();
    const signedTxBase64 = Buffer.from(signedTxBytes).toString('base64');
    const result = await broadcastTxCommit(sandboxRpcClient, {
        signedTxBase64,
        waitUntil: 'FINAL',
    });

    if (result.status.Failure) {
        throw new Error(`Failed to deploy contract to ${accountId}`);
    }
}

async function functionCall(
    accountId,
    contractId,
    methodName,
    args,
    gas = '300000000000000',
    deposit = '0'
) {
    const keyPair = accountKeys.get(accountId);
    if (!keyPair) throw new Error(`No key for account ${accountId}`);

    const argsBuffer = args === null ? Buffer.from([]) : Buffer.from(JSON.stringify(args));
    const actions = [
        transactions.functionCall(
            methodName,
            argsBuffer,
            BigInt(gas),
            BigInt(deposit)
        ),
    ];

    const blockHash = await getLatestBlockHash();
    await new Promise((resolve) => setTimeout(() => resolve(), 2000));
    const nonce = await getAccessKeyNonce(accountId, keyPair.getPublicKey().toString());

    const tx = transactions.createTransaction(
        accountId,
        keyPair.getPublicKey(),
        contractId,
        nonce + 1,
        actions,
        utils.serialize.base_decode(blockHash)
    );

    const serializedTx = utils.serialize.serialize(transactions.SCHEMA.Transaction, tx);
    const txHash = crypto.createHash('sha256').update(serializedTx).digest();
    const signature = keyPair.sign(txHash);

    const signedTx = new transactions.SignedTransaction({
        transaction: tx,
        signature: new transactions.Signature({
            keyType: tx.publicKey.keyType,
            data: signature.signature,
        }),
    });

    const signedTxBytes = signedTx.encode();
    const signedTxBase64 = Buffer.from(signedTxBytes).toString('base64');
    const result = await broadcastTxCommit(sandboxRpcClient, {
        signedTxBase64,
        waitUntil: 'FINAL',
    });

    if (result.status.Failure) {
        console.error(
            `Failed to call ${methodName} on ${contractId}:`,
            JSON.stringify(result.status.Failure, null, 2)
        );
        throw new Error(`Function call failed: ${methodName}`);
    }

    return result;
}

describe('checkpermission', function () {
    this.timeout(60000);

    before(async () => {
        // Start sandbox
        sandbox = await Sandbox.start({
            version: '2.8.0',
            timeout: 60000,
            config: {
                additionalGenesis: {
                    total_supply: '1050000000000000000000000000000000',
                    records: [
                        {
                            Account: {
                                account_id: 'test.near',
                                account: {
                                    amount: '1000000000000000000000000000000000',
                                    locked: '50000000000000000000000000000000',
                                    code_hash: '11111111111111111111111111111111',
                                    storage_usage: 0,
                                    version: 'V1',
                                },
                            },
                        },
                        {
                            AccessKey: {
                                account_id: 'test.near',
                                public_key: DEFAULT_PUBLIC_KEY,
                                access_key: { nonce: 0, permission: 'FullAccess' },
                            },
                        },
                    ],
                },
            },
        });

        const sandboxRpcUrl = sandbox.rpcUrl;
        sandboxRpcClient = new NearRpcClient(sandboxRpcUrl);

        // Wait for sandbox to be ready
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Set up root key pair
        rootKeyPair = KeyPair.fromString(DEFAULT_PRIVATE_KEY);
        accountKeys.set('test.near', rootKeyPair);

        // Create contract account
        contractAccountId = 'contract.test.near';
        contractKeyPair = await createAccount(contractAccountId);

        // Deploy the contract
        const contractWasm = readFileSync('./nearcontract/out/main.wasm');
        await deployContract(contractAccountId, contractWasm);

        // Initialize the contract (init takes no args, so pass empty JSON object)
        await functionCall(contractAccountId, contractAccountId, 'init', {});

        // Configure checkpermission to use sandbox
        const keyStore = {
            getKey: async (networkId, accountId) => {
                return accountKeys.get(accountId);
            }
        };
        use_sandbox(contractAccountId, sandboxRpcUrl, keyStore);

        // Set up default 'test' repository with anonymous read permission
        await functionCall(
            contractAccountId,
            contractAccountId,
            'set_permission',
            {
                path: 'test',
                account_id: 'ANONYMOUS',
                permission: 0x08  // PERMISSION_FREE
            },
            '300000000000000',
            '100000000000000000000000'
        );
    });

    after(async () => {
        if (sandbox) {
            await sandbox.tearDown();
        }
    });

    it('should allow anonymous reads for the default test repository', async () => {
        const result = await checkPermission('test', 'ANONYMOUS');
        assert.equal(result.permission, PERMISSION_READER);
    });

    it('should become owner of repository', async () => {
        await functionCall(
            contractAccountId,
            contractAccountId,
            'set_permission',
            {
                path: reponame,
                account_id: contractAccountId,
                permission: PERMISSION_OWNER
            },
            '300000000000000',
            '100000000000000000000000'
        );

        const tokenMessage = Buffer.from(JSON.stringify({
            accountId: contractAccountId,
            iat: new Date().getTime()
        })).toString('base64');

        const messageHash = sha256.array(Buffer.from(tokenMessage));
        const signature = contractKeyPair.sign(Buffer.from(messageHash));
        const accessToken = tokenMessage + '.' + Buffer.from(signature.signature).toString('base64');

        const result = await checkPermission(reponame, accessToken);
        assert.equal(result.permission, PERMISSION_OWNER);
    });

    it('should check access for implicit accounts', async () => {
        const implicitAccountId = '3e393bf74cf63cf8e3851ea0fe6a92e56595f506947d7c66310e6ceac97a3e9f';

        await functionCall(
            contractAccountId,
            contractAccountId,
            'set_permission',
            {
                path: reponame,
                account_id: implicitAccountId,
                permission: PERMISSION_CONTRIBUTOR
            },
            '300000000000000',
            '100000000000000000000000'
        );

        const privateKey = new Uint8Array([254, 114, 130, 212,  33,  69, 193,  93,  12,  15, 108,  76,  19, 198, 118, 148, 193,  62,  78,   4,   9, 157, 188, 191, 132, 137, 188,  31,  54, 103, 246, 191,  62,  57,  59, 247,  76, 246,  60, 248, 227, 133,  30, 160, 254, 106, 146, 229, 101, 149, 245,   6, 148, 125, 124, 102,  49,  14, 108, 234, 201, 122,  62, 159]);

        const tokenMessage = btoa(JSON.stringify({ accountId: implicitAccountId, iat: new Date().getTime() }));
        const signature = nacl.sign.detached(new TextEncoder().encode(tokenMessage), privateKey);
        const accessToken = tokenMessage + '.' + btoa(String.fromCharCode(...signature));

        const result = await checkPermission(reponame, accessToken);
        assert.equal(result.permission, PERMISSION_CONTRIBUTOR);
    });
});
