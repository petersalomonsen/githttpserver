let outputlines = [];


var Module = {
    locateFile: function(s) {
      return 'https://unpkg.com/wasm-git@0.0.1/' + s;
    },
    'print': function(text) {
      outputlines.push(text);
      console.log(text);
    },
    'printErr': function(text) {
      outputlines.push('err: ' + text);
      console.error(text);
    }
};

importScripts('https://unpkg.com/wasm-git@0.0.1/lg2.js');

Module.onRuntimeInitialized = () => {
    const lg = Module;

    FS.mkdir('/working');
    FS.mount(MEMFS, { }, '/working');
    FS.chdir('/working');    

    FS.writeFile('/home/web_user/.gitconfig', '[user]\n' +
                'name = Test User\n' +
                'email = test@example.com');


    // clone a local git repository and make some commits

    lg.callMain(['clone',`${self.location.origin}/test`, 'testrepo']);
    FS.chdir('testrepo');

    outputlines = [];
    lg.callMain(['log']);
    
    postMessage({testfilecontents: FS.readFile('test.txt', {encoding: 'utf8'}),
      log: outputlines.join('\n')});    
    
    onmessage = (msg) => {
      FS.writeFile('test.txt', msg.data.testfilecontents);
      lg.callMain(['add', '--verbose', 'test.txt']);
      lg.callMain(['commit','-m',msg.data.commitmessage]);
      lg.callMain(['push']);

      outputlines = [];
      lg.callMain(['log']);
    
      postMessage({testfilecontents: FS.readFile('test.txt', {encoding: 'utf8'}),
        log: outputlines.join('\n')});    
      
    };
};