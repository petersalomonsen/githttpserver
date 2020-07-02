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
    while(dircontentselm.hasChildNodes()) {
        dircontentselm.removeChild(dircontentselm.firstChild);
    }
}

function clearconsole() {
    document.querySelector('#console').innerHTML = '';
}

worker.onmessage = (msg) => {
    const consolediv = document.querySelector('#console');

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
            document.querySelector('#commandtoolbar').style.display = 'flex';
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
        document.querySelector('#commandtoolbar').style.display = 'none';
        
        emptyDirView();
    }
    consolediv.scrollTop = consolediv.scrollHeight;
};

function clone() {
    document.querySelector('#clonebutton').disabled = true;
    worker.postMessage({
        command: 'clone',
        url: document.querySelector("#gitrepourl").value
    });
}

function opendirentry(filename) {
    worker.postMessage({
        command: 'readfile',
        filename: filename
    });
        
    addFileContentListener(filename, contents => {
        let blob;
        if (filename.indexOf('.') > 0) {
            switch(filename.split('.')[1]) {
                case 'md':
                    blob = new Blob([marked(contents)], {type: 'text/html'});
                    break;
                case 'html':
                    blob = new Blob([contents], {type: 'text/html'});
                    break;
                default:
                    blob = new Blob([contents], {type: 'text/plain'});
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

function synclocal() {
    emptyDirView();
    document.querySelector('#clonebutton').disabled = false;
    document.querySelector('#commandtoolbar').style.display = 'none';
    const remoteUrl = document.querySelector("#gitrepourl").value;
    localStorage.setItem('lastRemoteUrl', remoteUrl);
    worker.postMessage({
        command: 'synclocal',
        url: remoteUrl
    });
}

function deletelocal() {
    worker.postMessage({
        command: 'deletelocal',
        url: document.querySelector("#gitrepourl").value
    });
}

function gitcommand(cmd) {
    worker.postMessage({
        command: cmd
    });
}

function openEditor(filename) {
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
            if(filenamefieldelement.value && el.value !== contents) {
                worker.postMessage({
                    command: 'writeandcommit',
                    commitmessage: commitmessageelement.value,
                    filename: filenamefieldelement.value,
                    contents: el.value
                });
                document.body.removeChild(document.querySelector('#editor'));
            } else if (!filenamefieldelement.value ) {
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
const nearconfig = {
    nodeUrl: 'https://rpc.testnet.near.org',
    walletUrl: 'https://wallet.testnet.near.org',
    helperUrl: 'https://helper.testnet.near.org',
    contractName: 'acl.testnet',
    deps: {
      keyStore: new nearApi.keyStores.BrowserLocalStorageKeyStore()
    }
  };
  
// open a connection to the NEAR platform

async function login() {
    await walletConnection.requestSignIn(
        nearconfig.contractName,
        'WASM-git'
    );
    await loadAccountData();
}

async function logout() {
    await walletConnection.requestSignOut();
}

async function loadAccountData() {
    let currentUser = {
        accountId: walletConnection.getAccountId(),
        balance: (await walletConnection.account().state()).amount
    }
    document.querySelector('#loginbutton').style.display = 'none';
    document.querySelector('#currentuserspan').innerHTML = currentUser.accountId;
    const tokenMessage = btoa(JSON.stringify({accountId: currentUser.accountId, iat: new Date().getTime()}));
    const signature = await walletConnection.account()
        .connection.signer
            .signMessage(new TextEncoder().encode(tokenMessage), currentUser.accountId
    );

    worker.postMessage({
        accessToken: tokenMessage + '.' + btoa(String.fromCharCode(...signature.signature)),
        useremail: currentUser.accountId,
        username: currentUser.accountId
    });
}

(async function() {
    window.near = await nearApi.connect(nearconfig);
    const walletConnection = new nearApi.WalletConnection(near);
    window.walletConnection = walletConnection;

    console.log(walletConnection);

    // Load in account data
    if (walletConnection.getAccountId()) {
        loadAccountData();
    } else {
        console.log('no loggedin user');
        return;
    }
    
    
})(window)
