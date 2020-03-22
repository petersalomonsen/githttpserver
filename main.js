const worker = new Worker('demo_webworker.js');
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

worker.onmessage = (msg) => {
    const consolediv = document.querySelector('#console');

    if (msg.data.ready) {
        synclocal();
    } else if (msg.data.stdout) {
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

function commitAndPush() {
    worker.postMessage({
        testfilecontents: document.querySelector("#testtextfilecontents").value,
        commitmessage: document.querySelector("#commitmessageinput").value
    });
}

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
    worker.postMessage({
        command: 'readfile',
        filename: filename
    });
    addFileContentListener(filename, contents => {
        const editorElement = document.querySelector('#editortemplate').content.cloneNode(true);
        const el = editorElement.querySelector('textarea');
        el.value = contents;
        const filenamefieldelement = editorElement.querySelector('#filenamefield');
        filenamefieldelement.value = filename;
        editorElement.querySelector('#savebutton').onclick = () => {
            if(el.value !== contents) {
                worker.postMessage({
                    command: 'writecommitandpush',
                    filename: filenamefieldelement.value,
                    contents: el.value
                });
            }
            document.body.removeChild(document.querySelector('#editor'));
        };

        editorElement.querySelector('#cancelbutton').onclick = () => {
            document.body.removeChild(document.querySelector('#editor'));
        }

        document.body.appendChild(editorElement);
    });
}

const lastUrl = localStorage.getItem('lastRemoteUrl');
document.querySelector("#gitrepourl").value = lastUrl ? lastUrl : `${self.location.origin}/test`;