import { checkPermission, PERMISSION_READER, PERMISSION_CONTRIBUTOR } from './checkpermission.js';
import {default as nearApi} from 'near-api-js';
import * as assert from 'assert';

const networkId = 'testnet';
const testAccountName = 'wasmgitunittest.testnet';

async function setUpTestConnection() {
    const keyStore = new nearApi.keyStores.InMemoryKeyStore();
    await keyStore.setKey(networkId, testAccountName, nearApi.utils.KeyPair.fromString('ed25519:3VyqE9YvDhECgCNnei5HWzcHpbX9qXW6TNUWSEN29shvt38RwXTsCDNMyyKKMskv5VzTKdEHJbTh6z7xzLVUZAo8'));

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

describe('checkpermission', function() {
    this.timeout(20000);
    it('should allow anonymous reads for the default test repository', async () => {
        assert.equal((await checkPermission('test', 'ANONYMOUS')).permission, PERMISSION_READER);
    });
    it('should allow write access for any authenticated user on the default test repo', async () => {
        const near = await setUpTestConnection();
        const testAccount = await near.account(testAccountName);
        
        const tokenMessage = Buffer.from(JSON.stringify({accountId: testAccount.accountId, iat: new Date().getTime()})).toString('base64');

        const signature = await testAccount.connection.signer
                .signMessage(new TextEncoder().encode(tokenMessage), testAccount.accountId, networkId);

        const accessToken = tokenMessage + '.' + Buffer.from(signature.signature).toString('base64');
        assert.equal((await checkPermission('test', accessToken)).permission, PERMISSION_CONTRIBUTOR);
    });
});