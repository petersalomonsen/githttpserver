/**
 * This example will create a git http server to repositories on your local disk.
 * Set the GIT_PROJECT_ROOT environment variable to point to location of your git repositories.
 */

import { checkPermission, PERMISSION_OWNER, PERMISSION_CONTRIBUTOR, PERMISSION_FREE } from './checkpermission.js';

import { createServer } from 'http';
import { exists, readFile } from 'fs';
import * as cgi from 'cgi';

function createCGI(accountId) {
    return cgi.default('git', {args: ['http-backend'],
                    stderr: process.stderr,
                    env: {
                        'GIT_PROJECT_ROOT': process.env.GIT_PROJECT_ROOT,
                        'GIT_HTTP_EXPORT_ALL': '1',
                        'REMOTE_USER': accountId
                    }
                });
};

const publicdir = `${process.cwd()}/public`;

createServer(async (request, response) => {
    let path = request.url.substring(1).split(/\?/)[0];

    if(path === '') {
        path = 'index.html';
    }

    response.setHeader("Access-Control-Allow-Origin", "*");
    console.log(request.method, request.url);

    if (request.method==='OPTIONS') {
        response.setHeader("Access-Control-Allow-Headers", "*");
        response.statusCode = 200;
        response.end();
    } else if( request.url.indexOf('git-upload') > -1 ||
            request.url.indexOf('git-receive') > -1) {  
        
        try {
            const repository = path.split('/')[0];
            
            // Access control
            let { accountId, permission } = await checkPermission(repository,
                request.headers.authorization ? request.headers.authorization.substring('Bearer '.length) : 'ANONYMOUS'
            );
            // Invoke git            
            if (permission & (PERMISSION_OWNER | PERMISSION_CONTRIBUTOR | PERMISSION_FREE)) {
                // Read and write permission
                createCGI(accountId)(request, response);
            } else if(permission) {
                // read only
                createCGI()(request, response);
            } else {
                console.error('permission denied to', repository, 'for', accountId, 'with permission', permission);
                response.statusCode = 403;
                response.end("permission denied");
            }
        } catch(e) {
            console.error('invalid token', e);
            response.statusCode = 403;
            response.end("invalid token");
        }
    } else if(await new Promise(resolve => exists(`${publicdir}/${path}`, res => resolve(res)))) {
        if (path.indexOf('.js') === path.length-3) {
            response.setHeader('Content-Type', 'application/javascript');
        } else if (path.indexOf('.wasm') === path.length-5) {
            response.setHeader('Content-Type', 'application/wasm');
        }
        response.end(await new Promise(resolve => readFile(`${publicdir}/${path}`, (err, data) => resolve(data))));
    } else {
        response.statusCode = 404;
        response.end("not found");
    }
}).listen(5000);