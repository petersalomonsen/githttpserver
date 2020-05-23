


var Module = {
    locateFile: function(s) {
      return 'https://unpkg.com/wasm-git@0.0.2/' + s;
    },
    'print': function(text) {
      
      console.log(text);
      postMessage({'stdout': text});
    },
    'printErr': function(text) {
      
      console.error(text);
      postMessage({'stderr': text});
    }
};

let accessToken = 'ANONYMOUS';
XMLHttpRequest.prototype._open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
  this._open(method, url, async, user, password);
  this.setRequestHeader('Authorization', `Bearer ${accessToken}`);
}
importScripts('https://unpkg.com/wasm-git@0.0.2/lg2.js');

Module.onRuntimeInitialized = () => {
    const lg = Module;

    FS.writeFile('/home/web_user/.gitconfig', '[user]\n' +
                'name = Test User\n' +
                'email = test@example.com');

    let currentRepoRootDir;

    onmessage = (msg) => {
      if (msg.data.accessToken) {
        accessToken = msg.data.accessToken;
        callMain(["config", "user.name", msg.data.username])
        callMain(["config", "user.email", msg.data.useremail])
      } else if (msg.data.command === 'writeandcommit') {
        FS.writeFile(msg.data.filename, msg.data.contents);
        lg.callMain(['add', '--verbose', msg.data.filename]);
        lg.callMain(['commit','-m', msg.data.commitmessage]);  
        FS.syncfs(false, () => {
          console.log(currentRepoRootDir, 'stored to indexeddb');
          postMessage({ dircontents: FS.readdir('.') });
        });      
      } else if (msg.data.command === 'push') {
        lg.callMain(['push']);
        FS.syncfs(false, () => {
          console.log(currentRepoRootDir, 'stored to indexeddb');
          postMessage({ dircontents: FS.readdir('.') });
        });
      } else if (msg.data.command === 'synclocal') {
        currentRepoRootDir = msg.data.url.substring(msg.data.url.lastIndexOf('/') + 1);
        console.log('synclocal', currentRepoRootDir);

        FS.mkdir(`/${currentRepoRootDir}`);
        FS.mount(IDBFS, { }, `/${currentRepoRootDir}`);
        
        FS.syncfs(true, () => {
          
          if( FS.readdir(`/${currentRepoRootDir}`).find(file => file === '.git') ) {
            FS.chdir( `/${currentRepoRootDir}` );
            postMessage({ dircontents: FS.readdir('.') });
            console.log(currentRepoRootDir, 'restored from indexeddb');
          } else {
            FS.chdir( '/' );
            console.log('no git repo in', currentRepoRootDir);
          }
        });
      } else if (msg.data.command === 'deletelocal') {
        
        FS.unmount(`/${currentRepoRootDir}`);
        console.log('deleting database', currentRepoRootDir);
        self.indexedDB.deleteDatabase('/' + currentRepoRootDir);
        postMessage({ deleted: currentRepoRootDir});
      } else if (msg.data.command === 'clone') {
        currentRepoRootDir = msg.data.url.substring(msg.data.url.lastIndexOf('/') + 1);
        
        postMessage({stdout: `git clone ${msg.data.url}`});
        lg.callMain(['clone', msg.data.url, currentRepoRootDir]);
        FS.chdir(currentRepoRootDir);

        FS.syncfs(false, () => {
          console.log(currentRepoRootDir, 'stored to indexeddb');
        });
        postMessage({ dircontents: FS.readdir('.') });
      } else if (msg.data.command === 'pull') {
        lg.callMain(['fetch', 'origin']);
        lg.callMain(['merge', 'origin/master']);
        FS.syncfs(false, () => {
          console.log(currentRepoRootDir, 'stored to indexeddb');
        });
      } else if (msg.data.command === 'readfile') {
        try {
          postMessage({
            filename: msg.data.filename,
            filecontents: FS.readFile(msg.data.filename, {encoding: 'utf8'})
          });
        } catch (e) {
          postMessage({'stderr': JSON.stringify(e)});
        }
      } else {
        lg.callMain([msg.data.command]);
      }
    };

    postMessage({'ready': true});
};