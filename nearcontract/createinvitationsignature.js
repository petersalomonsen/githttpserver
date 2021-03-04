import * as nearApi from 'near-api-js';
import { default as nacl } from 'tweetnacl';

const accountId = process.argv[2];

const invitationId = 1;
const tokenMessage = `invitation${invitationId}`;

let nearconfig = {
    nodeUrl: 'https://rpc.testnet.near.org',
    walletUrl: 'https://wallet.testnet.near.org',
    helperUrl: 'https://helper.testnet.near.org',
    networkId: 'testnet',
    contractName: 'acl.testnet',
    deps: {
        keyStore: new nearApi.keyStores.UnencryptedFileSystemKeyStore(process.env.HOME+'/.near-credentials')
    }
};

const near = await nearApi.connect(nearconfig);
const account = await near.account(accountId);

const keypair = await account.connection.signer.keyStore.getKey(nearconfig.networkId, accountId);
const signature = await keypair.sign(Buffer.from(tokenMessage));

const signaturestring = Buffer.from(signature.signature).toString('base64');
console.log(signaturestring);
const public_key = await account.connection.signer.getPublicKey(accountId, nearconfig.networkId);
console.log('public key', Buffer.from(public_key.data).toString('hex'), public_key.data);
const verifyResult = nacl.sign.detached.verify(Buffer.from(tokenMessage),
            Buffer.from(signaturestring, 'base64'), public_key.data);

console.log('signature verify result', verifyResult);
