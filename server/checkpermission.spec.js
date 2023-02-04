import { checkPermission, PERMISSION_READER, PERMISSION_CONTRIBUTOR, use_testnet, PERMISSION_OWNER } from './checkpermission.js';
import { default as nearApi } from 'near-api-js';
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
    it('should allow anonymous reads for the default test repository', async () => {
        assert.equal((await checkPermission('test', 'ANONYMOUS')).permission, PERMISSION_READER);
    });
    it('should become owner of repository', async () => {
        const near = await setUpTestConnection();
        const testAccount = await near.account(testAccountName);

        const reponame = 'test2';
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
});