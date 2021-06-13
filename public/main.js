import { modal } from './modal.js';

const worker = new Worker('libgit2_webworker.js');
const filecontentslisteners = {};

function addFileContentListener(filename, listenerfunc) {
    if (!filecontentslisteners[filename]) {
        filecontentslisteners[filename] = [];
    }
    filecontentslisteners[filename].push(listenerfunc);
}

function emptyDirView() {
    const dircontentselm = document.querySelector('#dircontents');
    while (dircontentselm.hasChildNodes()) {
        dircontentselm.removeChild(dircontentselm.firstChild);
    }
}

window.newRepository = async function () {
    const repositoryName = await modal(`
        <h3>Reserve repository name</h3>
        <p>This will set your account as the owner of the repository with the specified name,
        provided it's not already taken.</p>
        <ul style="color: white; text-align: left">
            <li>You will be charged 0.1N for the name (storage is not included)</li>
            <li>Keep your repositories small (max 10MB)</li>
            <li>Storage costs may be introduced in the future</li>
            <li>Repositories stored on the server may be deleted, so keep a backup on your own (clone using a terminal)</li>
        </ul>
        <p><input style="font-size: 18px; width: 100%;" type="text" placeholder="enter repository name"></p>
        <button onclick="getRootNode().result(null)">cancel</button>
        <button onclick="getRootNode().result(getRootNode().querySelector('input').value)">create</button>
    `);
    if (repositoryName) {
        await takeOwnershipOfRepository(repositoryName);
    }
}

window.clearconsole = function () {
    document.querySelector('#consolecontent').innerHTML = '';
}

worker.onmessage = (msg) => {
    const consolediv = document.querySelector('#consolecontent');

    if (msg.data.stdout) {
        const logline = document.createElement('pre');
        logline.innerHTML = msg.data.stdout;
        consolediv.appendChild(logline);
    } else if (msg.data.stderr) {
        const logline = document.createElement('pre');
        logline.innerHTML = msg.data.stderr;
        logline.style.color = 'red';
        consolediv.appendChild(logline);
    } else if (msg.data.dircontents) {
        const dircontentselm = document.querySelector('#dircontents');

        if (msg.data.dircontents.find(dir => dir === '.git')) {
            document.querySelector('#clonebutton').disabled = true;
        }

        emptyDirView();

        msg.data.dircontents
            .filter(direntry => direntry.indexOf('.') > 0) // only showing files for now
            .forEach(direntry => {
                const dircontentlineelement = document.querySelector('#dircontentline').content.cloneNode(true);

                dircontentlineelement.querySelector('#filename').innerHTML = direntry;
                if (
                    direntry.indexOf('.') > 0
                ) {
                    dircontentlineelement.querySelector('#editbutton').onclick = () => openEditor(direntry);
                } else {
                    dircontentlineelement.querySelector('#editbutton').style.display = 'none';
                }
                dircontentselm.appendChild(dircontentlineelement);
            });
    } else if (msg.data.filecontents) {
        filecontentslisteners[msg.data.filename].forEach(func => func(msg.data.filecontents));
        delete filecontentslisteners[msg.data.filename];
    } else if (msg.data.deleted) {
        const dircontentselm = document.querySelector('#dircontents');

        document.querySelector('#clonebutton').disabled = false;

        emptyDirView();
    }
    consolediv.scrollTop = consolediv.scrollHeight;
};

window.clone = function () {
    document.querySelector('#clonebutton').disabled = true;
    worker.postMessage({
        command: 'clone',
        url: document.querySelector("#gitrepourl").value
    });
}

window.opendirentry = function (filename) {
    worker.postMessage({
        command: 'readfile',
        filename: filename
    });

    addFileContentListener(filename, contents => {
        let blob;
        if (filename.indexOf('.') > 0) {
            switch (filename.split('.')[1]) {
                case 'md':
                    blob = new Blob([marked(contents)], { type: 'text/html' });
                    break;
                case 'html':
                    blob = new Blob([contents], { type: 'text/html' });
                    break;
                default:
                    blob = new Blob([contents], { type: 'text/plain' });
                    break;
            }
        }
        window.open(
            URL.createObjectURL(
                blob
            )
        );
    });
}

window.synclocal = function () {
    emptyDirView();
    document.querySelector('#clonebutton').disabled = false;
    const remoteUrl = document.querySelector("#gitrepourl").value;
    localStorage.setItem('lastRemoteUrl', remoteUrl);
    worker.postMessage({
        command: 'synclocal',
        url: remoteUrl
    });
}

window.deletelocal = function () {
    worker.postMessage({
        command: 'deletelocal',
        url: document.querySelector("#gitrepourl").value
    });
}

window.gitcommand = function (cmd) {
    worker.postMessage({
        command: cmd
    });
}

window.openEditor = function (filename) {
    const onFileContentReady = contents => {
        const editorElement = document.querySelector('#editortemplate').content.cloneNode(true);
        const el = editorElement.querySelector('textarea');
        el.value = contents;
        const filenamefieldelement = editorElement.querySelector('#filenamefield');
        const commitmessageelement = editorElement.querySelector('#commitmessagefield');
        filenamefieldelement.value = filename;
        if (filename) {
            commitmessageelement.value = `edited ${filename}`;
        } else {
            commitmessageelement.value = 'add new file';
        }
        editorElement.querySelector('#savebutton').onclick = () => {
            if (filenamefieldelement.value && el.value !== contents) {
                worker.postMessage({
                    command: 'writeandcommit',
                    commitmessage: commitmessageelement.value,
                    filename: filenamefieldelement.value,
                    contents: el.value
                });
                document.body.removeChild(document.querySelector('#editor'));
            } else if (!filenamefieldelement.value) {
                console.error('missing filename');
            } else if (el.value === contents) {
                console.error('no changes');
            }
        };

        editorElement.querySelector('#cancelbutton').onclick = () => {
            document.body.removeChild(document.querySelector('#editor'));
        }

        document.body.appendChild(editorElement);
    };

    if (filename) {
        worker.postMessage({
            command: 'readfile',
            filename: filename
        });
        addFileContentListener(filename, onFileContentReady);
    } else {
        filename = '';
        onFileContentReady('new file');
    }
}

const lastUrl = localStorage.getItem('lastRemoteUrl');
document.querySelector("#gitrepourl").value = lastUrl ? lastUrl : `${self.location.origin}/test`;

synclocal();

// configure minimal network settings and key storage
const nearconfig_testnet = {
    nodeUrl: 'https://rpc.testnet.near.org',
    walletUrl: 'https://wallet.testnet.near.org',
    helperUrl: 'https://helper.testnet.near.org',
    contractName: 'acl.testnet',
    deps: {
        keyStore: new nearApi.keyStores.BrowserLocalStorageKeyStore()
    }
};
const nearconfig = {
    nodeUrl: 'https://rpc.mainnet.near.org',
    walletUrl: 'https://wallet.near.org',
    helperUrl: 'https://helper.mainnet.near.org',
    contractName: 'wasmgit.near',
    deps: {
        keyStore: new nearApi.keyStores.BrowserLocalStorageKeyStore()
    }
};

// open a connection to the NEAR platform

window.login = async function () {
    await walletConnection.requestSignIn(
        nearconfig.contractName,
        'WASM-git'
    );
    await loadAccountData();
}

window.logout = async function () {
    await walletConnection.requestSignOut();
}

window.terminalconfig = async () => {
    if (!walletConnection.getAccountId()) {
        await modal(`<h3>Requires login</h3>
        <p>Creating credentials for terminal git requires a logged in user.</p>
        <button onclick="getRootNode().result(null)">Close</button>
        `);
        return;
    }

    const accessToken = await createAccessToken();
    await modal(`    
        <h3>Clone</h3>
        <div style="display: flex;">
            <pre><code id="clonesnippet">git clone -c http.extraheader="Authorization: Bearer ${accessToken}" ${document.querySelector("#gitrepourl").value}</code></pre>
            <button style="font-size: 14px" onclick="getRootNode().copyToClipboard('clonesnippet')">Copy</button>
        </div>
        <h3>Configure token in existing cloned repo</h3>
        <div style="display: flex;">
            <pre><code id="configsnippet">git config http.extraheader "Authorization: Bearer ${accessToken}"</code></pre>
            <button style="font-size: 14px" onclick="getRootNode().copyToClipboard('configsnippet')">Copy</button>
        </div>
        <p style="color: white">The generated token is valid for 24 hours</p>
        <button onclick="getRootNode().result(null)">Close</button>
    `);
};

async function createAccessToken() {
    const accountId = walletConnection.getAccountId();
    const tokenMessage = btoa(JSON.stringify({ accountId: accountId, iat: new Date().getTime() }));
    const signature = await walletConnection.account()
        .connection.signer
        .signMessage(new TextEncoder().encode(tokenMessage), accountId);
    return tokenMessage + '.' + btoa(String.fromCharCode(...signature.signature));
}

async function loadAccountData() {
    let currentUser = {
        accountId: walletConnection.getAccountId(),
        balance: (await walletConnection.account().state()).amount
    }
    document.querySelector('#loginbutton').style.display = 'none';
    document.querySelector('#currentuserspan').innerHTML = currentUser.accountId;
    const tokenMessage = btoa(JSON.stringify({ accountId: currentUser.accountId, iat: new Date().getTime() }));
    const signature = await walletConnection.account()
        .connection.signer
        .signMessage(new TextEncoder().encode(tokenMessage), currentUser.accountId
        );

    worker.postMessage({
        accessToken: await createAccessToken(),
        useremail: currentUser.accountId,
        username: currentUser.accountId
    });
}

async function takeOwnershipOfRepository(path) {
    walletConnection.account().functionCall(nearconfig.contractName, 'set_permission',
        {
            'account_id': window.walletConnection.getAccountId(),
            'path': path, 'permission': 1
        }
        , null, new BN('100000000000000000000000', 10));
}

(async function () {
    window.near = await nearApi.connect(nearconfig);
    const walletConnection = new nearApi.WalletAccount(window.near);
    window.walletConnection = walletConnection;

    window.permissionContract = await near.loadContract(nearconfig.contractName, {
        // View methods are read only. They don't modify the state, but usually return some value.
        viewMethods: ["get_permission"],
        // Change methods can modify the state. But you don't receive the returned value when called.
        changeMethods: ["set_permission"],
        sender: walletConnection.getAccountId()
    });

    console.log(walletConnection);

    // Load in account data
    if (walletConnection.getAccountId()) {
        loadAccountData();
    } else {
        console.log('no loggedin user');
        return;
    }


})(window)
