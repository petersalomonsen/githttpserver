// Git worker: wasm-git with the working tree persisted in OPFS.
//
// Module worker. Every request carries an `id`; the reply echoes it as
// `{ id, result }` or `{ id, error }`. Unsolicited `{ log }` / `{ logerr }`
// messages carry git's console output for the output panel.
//
// lg2_opfs_auto.js picks the best OPFS build the browser supports: pthreads
// when cross-origin isolated, otherwise JSPI, otherwise ASYNCIFY. In the two
// SAB-free builds the filesystem is an in-memory cache, so files written from
// JS must go through git.writeFile (and removed through opfsRemoveTree) to
// reach OPFS. Whatever git itself writes is persisted by the build.

const WASM_GIT_BASE = 'https://cdn.jsdelivr.net/npm/wasm-git@0.0.17/';

let accessToken = null;
const DEFAULT_IDENTITY = { name: 'wasm-git user', email: 'anonymous@wasm-git' };
let identity = { ...DEFAULT_IDENTITY };
let repoName = null;
let stdout = '';
let stderr = '';
let capture = false;

// The git HTTP transport uses synchronous XHR; attach the bearer token there.
// No header at all for anonymous access, which the server treats as ANONYMOUS.
XMLHttpRequest.prototype._open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
    this._open(method, url, async, user, password);
    if (accessToken) {
        this.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    }
};

let git, FS;
const ready = (async () => {
    const { loadOpfsGit } = await import(`${WASM_GIT_BASE}lg2_opfs_auto.js`);
    git = await loadOpfsGit({
        baseUrl: WASM_GIT_BASE,
        moduleOverrides: {
            print: (text) => { if (capture) stdout += text + '\n'; postMessage({ log: text }); },
            printErr: (text) => { if (capture) stderr += text + '\n'; postMessage({ logerr: text }); },
        },
    });
    FS = git.FS;
    postMessage({ log: `wasm-git ready (${git.variant})` });
})();

const repoDir = () => git.repoDir(repoName);

function requireRepo() {
    if (!repoName || !FS.analyzePath(`${repoDir()}/.git`).exists) {
        throw new Error('no local clone, clone the repository first');
    }
}

async function run(args) {
    FS.chdir(repoDir());
    capture = true;
    stdout = '';
    stderr = '';
    try {
        await git.run(args);
    } finally {
        capture = false;
    }
    return { stdout, stderr };
}

/** Like run, but treats anything on stderr as failure. */
async function runChecked(args) {
    const out = await run(args);
    if (out.stderr.trim()) {
        throw new Error(`git ${args[0]}: ${out.stderr.trim()}`);
    }
    return out;
}

function safePath(path) {
    const clean = String(path).replace(/^\/+/, '');
    if (!clean || clean.split('/').some(p => p === '..' || p === '.git' || p === '')) {
        throw new Error(`invalid path: ${path}`);
    }
    return clean;
}

function isDir(path) {
    return FS.isDir(FS.stat(path).mode);
}

function listTree() {
    const files = [];
    const walk = (abs, rel) => {
        for (const name of FS.readdir(abs)) {
            if (name === '.' || name === '..' || (rel === '' && name === '.git')) continue;
            const childAbs = `${abs}/${name}`;
            const childRel = rel ? `${rel}/${name}` : name;
            if (isDir(childAbs)) {
                files.push(childRel + '/');
                walk(childAbs, childRel);
            } else {
                files.push(childRel);
            }
        }
    };
    walk(repoDir(), '');
    return files;
}

async function applyIdentity() {
    // The repo's own config: ~/.gitconfig is not reliably read after a merge.
    await run(['config', 'user.name', identity.name]);
    await run(['config', 'user.email', identity.email]);
}

/**
 * Porcelain status as { path: 'XY' }. lg2 prints `XY path` per line, with
 * `R  old -> new` for renames.
 */
async function status() {
    const { stdout } = await run(['status', '--porcelain']);
    const result = {};
    for (const line of stdout.split('\n')) {
        if (line.length < 4) continue;
        let path = line.substring(3);
        const arrow = path.indexOf(' -> ');
        if (arrow > -1) path = path.substring(arrow + 4);
        result[path] = line.substring(0, 2);
    }
    return result;
}

function currentBranch() {
    const head = FS.readFile(`${repoDir()}/.git/HEAD`, { encoding: 'utf8' }).trim();
    return head.startsWith('ref: refs/heads/') ? head.substring('ref: refs/heads/'.length) : null;
}

async function pull() {
    const branch = currentBranch() || 'master';
    await runChecked(['fetch', 'origin']);
    if (!FS.analyzePath(`${repoDir()}/.git/refs/remotes/origin/${branch}`).exists
        && !packedRefExists(`refs/remotes/origin/${branch}`)) {
        return { merged: false, message: `origin/${branch} does not exist yet` };
    }
    await applyIdentity();
    const { stdout } = await runChecked(['merge', `origin/${branch}`]);
    return { merged: true, message: stdout.trim() };
}

/**
 * `cat-file -p HEAD:<path>`. Emscripten's stdout is line-buffered and never
 * flushes a last line without a newline, so the tail of a file that does not
 * end in one would surface in front of the NEXT command's output. `rev-parse
 * HEAD` right after drains it: its output is that tail, then a 40-hex sha and
 * a newline.
 */
async function readHead(path) {
    const head = await run(['cat-file', '-p', `HEAD:${path}`]);
    const flush = await run(['rev-parse', 'HEAD']);
    if (head.stderr.trim()) return null;
    const match = /^([\s\S]*)[0-9a-f]{40}\n$/.exec(flush.stdout);
    return head.stdout + (match ? match[1] : '');
}

function packedRefExists(ref) {
    const packed = `${repoDir()}/.git/packed-refs`;
    if (!FS.analyzePath(packed).exists) return false;
    return FS.readFile(packed, { encoding: 'utf8' }).split('\n').some(l => l.endsWith(' ' + ref));
}

const handlers = {
    async configureuser({ token, name, email }) {
        accessToken = token || null;
        identity = name ? { name, email: email || name } : { ...DEFAULT_IDENTITY };
        return true;
    },

    /** Open the local copy of a repo, if there is one. */
    async open({ url }) {
        repoName = repoNameFromUrl(url);
        const exists = await git.syncRepo(repoName);
        if (exists) {
            await run(['config', 'core.fileMode', 'false']);
        }
        return { cloned: exists };
    },

    async clone({ url }) {
        repoName = repoNameFromUrl(url);
        postMessage({ log: `git clone ${url}` });
        await git.clone(url, repoName);
        if (!FS.analyzePath(`${repoDir()}/.git`).exists) {
            throw new Error('clone failed');
        }
        // OPFS has no real mode bits; without this every file shows as modified.
        await run(['config', 'core.fileMode', 'false']);
        return { cloned: true };
    },

    async deletelocal() {
        if (repoName) await git.removeRepo(repoName);
        return true;
    },

    async tree() {
        requireRepo();
        return { files: listTree(), status: await status() };
    },

    async readfile({ path }) {
        requireRepo();
        return FS.readFile(`${repoDir()}/${safePath(path)}`, { encoding: 'utf8' });
    },

    /** Save to the working tree only. Nothing is staged or committed. */
    async writefile({ path, contents }) {
        requireRepo();
        const rel = safePath(path);
        if (git.variant === 'pthreads') {
            // WasmFS: create parent dirs, and truncate explicitly since
            // writeFile does not on the OPFS backend.
            const parts = rel.split('/');
            let dir = repoDir();
            for (const part of parts.slice(0, -1)) {
                dir += '/' + part;
                try { FS.mkdir(dir); } catch (e) { /* exists */ }
            }
            const data = new TextEncoder().encode(contents);
            const fd = FS.open(`${repoDir()}/${rel}`, 577); // O_WRONLY | O_CREAT | O_TRUNC
            FS.write(fd, data, 0, data.length, 0);
            FS.close(fd);
        } else {
            // Creates parent dirs in both the memory cache and OPFS.
            await git.writeFile(repoName, rel, contents);
        }
        return true;
    },

    async deletepath({ path }) {
        requireRepo();
        const abs = `${repoDir()}/${safePath(path)}`;
        if (git.variant === 'pthreads') {
            const rm = (p) => {
                if (isDir(p)) {
                    for (const n of FS.readdir(p)) if (n !== '.' && n !== '..') rm(`${p}/${n}`);
                    FS.rmdir(p);
                } else {
                    FS.unlink(p);
                }
            };
            rm(abs);
        } else {
            await git.module.opfsRemoveTree(abs);
        }
        return true;
    },

    async status() {
        requireRepo();
        return await status();
    },

    /**
     * Search working-tree text files. Returns { matches: [{path, line, text}], truncated }.
     * `pattern` is a JavaScript regular expression; `path` limits the search to a file or folder.
     */
    async grep({ pattern, path = '', ignoreCase = false, maxMatches = 200 }) {
        requireRepo();
        const regex = new RegExp(pattern, ignoreCase ? 'i' : '');
        const prefix = path ? safePath(path.replace(/\/+$/, '')) : '';
        const matches = [];
        for (const file of listTree()) {
            if (file.endsWith('/')) continue;
            if (prefix && file !== prefix && !file.startsWith(prefix + '/')) continue;
            const bytes = FS.readFile(`${repoDir()}/${file}`);
            if (bytes.length > 1024 * 1024 || bytes.subarray(0, 8000).includes(0)) continue;
            const lines = new TextDecoder().decode(bytes).split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                    matches.push({ path: file, line: i + 1, text: lines[i].substring(0, 300) });
                    if (matches.length >= maxMatches) return { matches, truncated: true };
                }
            }
        }
        return { matches, truncated: false };
    },

    /** A file's committed (HEAD) contents, or null if HEAD does not have it. */
    async readhead({ path }) {
        requireRepo();
        return await readHead(safePath(path));
    },

    /** Restore a file to its committed version, or remove it if it is not committed. */
    async discard({ path }) {
        requireRepo();
        const rel = safePath(path);
        const committed = await readHead(rel);
        if (committed === null) {
            await handlers.deletepath({ path: rel });
        } else {
            await handlers.writefile({ path: rel, contents: committed });
        }
        return { restored: committed !== null };
    },

    async diff() {
        requireRepo();
        return (await run(['diff'])).stdout;
    },

    async log() {
        requireRepo();
        return (await run(['log'])).stdout;
    },

    /** Stage every change in the working tree (new, modified, deleted) and commit. */
    async commit({ message }) {
        requireRepo();
        await applyIdentity();
        // lg2's add has no -A: `add .` picks up new + modified files,
        // `add --update .` records modifications and deletions of tracked ones.
        await run(['add', '.']);
        await run(['add', '--update', '.']);
        const st = await status();
        const staged = Object.values(st).some(xy => xy[0] !== ' ' && xy[0] !== '?');
        if (!staged) return { committed: false };
        await runChecked(['commit', '-m', message]);
        return { committed: true };
    },

    async pull() {
        requireRepo();
        return await pull();
    },

    /** Pull first (so the push is a fast-forward), then push. */
    async push() {
        requireRepo();
        const pulled = await pull();
        await runChecked(['push']);
        return pulled;
    },
};

function repoNameFromUrl(url) {
    const name = String(url).replace(/\/+$/, '').split('/').pop();
    if (!name) throw new Error(`no repository name in ${url}`);
    return name;
}

// One request at a time: git state is shared, and the async builds yield
// mid-command.
let queue = Promise.resolve();

self.onmessage = (msg) => {
    const { id, command, ...params } = msg.data;
    queue = queue.then(async () => {
        try {
            await ready;
            const handler = handlers[command];
            if (!handler) throw new Error(`unknown command: ${command}`);
            postMessage({ id, result: await handler(params) });
        } catch (e) {
            postMessage({ id, error: describeError(e) });
        }
    });
};

function describeError(e) {
    if (typeof e === 'string') return e;
    if (e?.message) return e.message;
    if (e?.errno !== undefined) return `file system error (errno ${e.errno})`;
    return String(e);
}
