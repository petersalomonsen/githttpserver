import { checkPermission, PERMISSION_READER, PERMISSION_CONTRIBUTOR, use_testnet, PERMISSION_OWNER } from './checkpermission.js';
import { default as nearApi } from 'near-api-js';
import { default as nacl } from 'tweetnacl';
import { homedir } from 'os';
import * as assert from 'assert';
import { readFileSync } from 'fs';

const networkId = 'testnet';
const testAccountName = readFileSync('./nearcontract/neardev/dev-account').toString();

use_testnet(testAccountName);

async function setUpTestConnection() {
    const keyStore = new nearApi.keyStores.UnencryptedFileSystemKeyStore(`${homedir()}/.near-credentials`);

    const config = Object.assign({
        networkId: networkId,
        nodeUrl: 'https://rpc.testnet.near.org',
        masterAccount: testAccountName,
    }, {
        networkId: networkId,
        deps: { keyStore },
    });

    return nearApi.connect(config);
}

describe('checkpermission', function () {
    this.timeout(20000);
    const reponame = 'test2';

    it('should allow anonymous reads for the default test repository', async () => {
        assert.equal((await checkPermission('test', 'ANONYMOUS')).permission, PERMISSION_READER);
    });
    it('should become owner of repository', async () => {
        const near = await setUpTestConnection();
        const testAccount = await near.account(testAccountName);

        await testAccount.functionCall({
            contractId: testAccount.accountId,
            methodName: 'set_permission',
            args: {
                path: reponame,
                account_id: testAccount.accountId,
                permission: PERMISSION_OWNER
            },
            attachedDeposit: '100000000000000000000000'
        });
        const tokenMessage = Buffer.from(JSON.stringify({ accountId: testAccount.accountId, iat: new Date().getTime() })).toString('base64');

        const signature = await testAccount.connection.signer
            .signMessage(new TextEncoder().encode(tokenMessage), testAccount.accountId, networkId);

        const accessToken = tokenMessage + '.' + Buffer.from(signature.signature).toString('base64');
        assert.equal((await checkPermission(reponame, accessToken)).permission, PERMISSION_OWNER);
    });
    it('should check access for implicit accounts', async () => {
        const implicitAccountId = '3e393bf74cf63cf8e3851ea0fe6a92e56595f506947d7c66310e6ceac97a3e9f';
        const near = await setUpTestConnection();
        const testAccount = await near.account(testAccountName);
        await testAccount.functionCall({
            contractId: testAccount.accountId,
            methodName: 'set_permission',
            args: {
                path: reponame,
                account_id: implicitAccountId,
                permission: PERMISSION_CONTRIBUTOR
            },
            attachedDeposit: '100000000000000000000000'
        });
        const privateKey = new Uint8Array([254, 114, 130, 212,  33,  69, 193,  93,  12,  15, 108,  76,  19, 198, 118, 148, 193,  62,  78,   4,   9, 157, 188, 191, 132, 137, 188,  31,  54, 103, 246, 191,  62,  57,  59, 247,  76, 246,  60, 248, 227, 133,  30, 160, 254, 106, 146, 229, 101, 149, 245,   6, 148, 125, 124, 102,  49,  14, 108, 234, 201, 122,  62, 159]);

        const tokenMessage = btoa(JSON.stringify({ accountId: implicitAccountId, iat: new Date().getTime() }));
        const signature = nacl.sign.detached(new TextEncoder().encode(tokenMessage), privateKey);
        const accessToken = tokenMessage + '.' + btoa(String.fromCharCode(...signature));

        assert.equal((await checkPermission(reponame, accessToken)).permission, PERMISSION_CONTRIBUTOR);
    });
});