import { Editor, extensionOf } from './editor.js';
import { dialog, prompt, confirm, alert, h } from './dialog.js';
import * as near from './near.js';

const $ = (id) => document.getElementById(id);

// ---- git worker ------------------------------------------------------------

const worker = new Worker(new URL('gitworker.js', import.meta.url), { type: 'module' });
const pending = new Map();
let nextId = 1;

worker.onmessage = ({ data }) => {
    if ('log' in data) return log(data.log);
    if ('logerr' in data) return log(data.logerr, 'err');
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
};
worker.onerror = (e) => {
    log(`git worker failed: ${e.message ?? 'unknown error'}`, 'err');
    showOutput();
};

function git(command, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, command, ...params });
    });
}

/** Hand the worker a fresh access token (they expire after 24h) before network operations. */
async function configureUser() {
    const token = await near.createAccessToken();
    const accountId = near.currentAccountId();
    await git('configureuser', { token, name: accountId, email: accountId });
}

// ---- output panel ----------------------------------------------------------

function log(text, kind = '') {
    // git progress lines redraw themselves with \r; keep only the final state.
    text = String(text).split('\r').filter(Boolean).pop() ?? '';
    const out = $('outputcontent');
    out.append(h('pre', { class: kind }, text));
    out.scrollTop = out.scrollHeight;
}

function showOutput() {
    $('output').classList.remove('collapsed');
}

$('outputtoggle').onclick = () => $('output').classList.toggle('collapsed');
$('outputclear').onclick = () => { $('outputcontent').innerHTML = ''; };

let busyCount = 0;
async function busy(label, fn) {
    busyCount++;
    const statusline = $('statusline');
    statusline.textContent = label + '…';
    statusline.classList.add('busy');
    log(`$ ${label}`, 'cmd');
    try {
        return await fn();
    } catch (e) {
        let message = e.message || String(e);
        if (/40[13]/.test(message)) {
            message += near.currentAccountId()
                ? '\nPermission denied. Check that your account has access to this repository.'
                : '\nPermission denied. Sign in to access this repository.';
        }
        log(message, 'err');
        showOutput();
        statusline.textContent = `${label} failed`;
        throw e;
    } finally {
        busyCount--;
        if (busyCount === 0) {
            statusline.classList.remove('busy');
            if (statusline.textContent === label + '…') statusline.textContent = '';
        }
    }
}

const quiet = (promise) => promise.catch(() => { });

// ---- repository ------------------------------------------------------------

const state = {
    url: '',
    cloned: false,
    files: [],
    status: {},
    expanded: new Set(),
    selected: null,
    tabs: [],          // { path, saved, dirty }
    active: null,
    preview: false,
};

function repoName() {
    return state.url.replace(/\/+$/, '').split('/').pop();
}

async function openRepository(url) {
    state.url = url;
    localStorage.setItem('lastRemoteUrl', url);
    for (const tab of [...state.tabs]) closeTab(tab.path, true);
    state.expanded = new Set(JSON.parse(localStorage.getItem(`expanded:${url}`) || '[]'));
    const { cloned } = await git('open', { url });
    setCloned(cloned);
    if (cloned) await refreshTree();
}

function setCloned(cloned) {
    state.cloned = cloned;
    $('clonebutton').textContent = cloned ? 'Re-clone' : 'Clone';
    for (const id of ['pullbutton', 'commitbutton', 'pushbutton', 'newfilebutton', 'refreshbutton']) {
        $(id).disabled = !cloned;
    }
    if (!cloned) {
        state.files = [];
        state.status = {};
        renderTree();
    }
    updateWorkspace();
}

async function clone() {
    const url = $('repourl').value.trim();
    if (!url) return;
    if (state.cloned && url === state.url) {
        const ok = await confirm('Re-clone repository?',
            'This deletes the local copy, including uncommitted and unpushed changes, and clones it again.',
            'Re-clone');
        if (!ok) return;
    }
    if (url !== state.url) await openRepository(url);
    await busy(`git clone ${url}`, async () => {
        await configureUser();
        await git('clone', { url });
    });
    setCloned(true);
    await refreshTree();
}

async function refreshTree() {
    if (!state.cloned) return;
    const { files, status } = await git('tree');
    state.files = files;
    state.status = status;
    renderTree();
}

/** 'M' | 'A' | 'D' | 'U' (untracked) | null for a path in porcelain status. */
function statusOf(path) {
    let xy = state.status[path];
    if (!xy) {
        // An untracked directory is reported once, as "?? dir/".
        const dir = Object.keys(state.status).find(p => p.endsWith('/') && path.startsWith(p));
        xy = dir ? state.status[dir] : null;
    }
    if (!xy) return null;
    if (xy === '??') return 'U';
    if (xy.includes('D')) return 'D';
    if (xy.includes('A') || xy.includes('R')) return 'A';
    return 'M';
}

function changedPaths() {
    return Object.keys(state.status).sort();
}

// ---- file tree -------------------------------------------------------------

function buildTree() {
    const root = { name: '', path: '', dirs: new Map(), files: [] };
    const dirNode = (path) => {
        let node = root;
        let acc = '';
        for (const part of path.split('/').filter(Boolean)) {
            acc += part + '/';
            if (!node.dirs.has(part)) node.dirs.set(part, { name: part, path: acc, dirs: new Map(), files: [] });
            node = node.dirs.get(part);
        }
        return node;
    };
    const paths = new Set(state.files);
    // Deleted files are gone from the working tree but still worth showing.
    for (const [path, xy] of Object.entries(state.status)) {
        if (xy.includes('D') && !path.endsWith('/')) paths.add(path);
    }
    for (const path of paths) {
        if (path.endsWith('/')) {
            dirNode(path);
        } else {
            const slash = path.lastIndexOf('/');
            dirNode(path.substring(0, slash + 1)).files.push({ name: path.substring(slash + 1), path });
        }
    }
    return root;
}

function renderTree() {
    const container = $('tree');
    container.innerHTML = '';
    if (!state.cloned) {
        container.append(h('div', { class: 'empty' }, 'No local clone.'));
        return;
    }
    const byName = (a, b) => a.name.localeCompare(b.name);
    const renderDir = (node, depth) => {
        for (const dir of [...node.dirs.values()].sort(byName)) {
            const open = state.expanded.has(dir.path);
            const changed = changedPaths().some(p => p.startsWith(dir.path));
            container.append(treeRow({
                path: dir.path,
                depth,
                twisty: open ? '▾' : '▸',
                name: dir.name,
                badge: changed ? '•' : '',
                cls: changed ? 'status-M' : '',
                onclick: () => {
                    state.selected = dir.path;
                    if (open) state.expanded.delete(dir.path);
                    else state.expanded.add(dir.path);
                    localStorage.setItem(`expanded:${state.url}`, JSON.stringify([...state.expanded]));
                    renderTree();
                },
            }));
            if (open) renderDir(dir, depth + 1);
        }
        for (const file of node.files.sort(byName)) {
            const status = statusOf(file.path);
            container.append(treeRow({
                path: file.path,
                depth,
                twisty: '',
                name: file.name,
                badge: status || '',
                cls: status ? `status-${status}` : '',
                onclick: () => {
                    state.selected = file.path;
                    if (status === 'D') {
                        renderTree();
                        log(`${file.path} is deleted in the working tree; commit to record the deletion.`);
                    } else {
                        quiet(openFile(file.path));
                    }
                },
                deletable: status !== 'D',
            }));
        }
    };
    renderDir(buildTree(), 0);
    if (!container.hasChildNodes()) {
        container.append(h('div', { class: 'empty' }, 'Empty repository. Use + to add a file.'));
    }
}

function treeRow({ path, depth, twisty, name, badge, cls, onclick, deletable = true }) {
    const row = h('div', {
        class: `row ${cls} ${state.selected === path ? 'selected' : ''}`,
        role: 'treeitem',
        title: path,
        style: `--depth: ${depth}`,
        onclick,
    },
        h('span', { class: 'twisty' }, twisty),
        h('span', { class: 'name' }, name),
        h('span', { class: 'badge' }, badge),
        deletable ? h('button', {
            class: 'icon delete',
            title: `Delete ${path}`,
            'aria-label': `Delete ${path}`,
            onclick: (e) => { e.stopPropagation(); quiet(deletePath(path)); },
        }, '×') : null);
    return row;
}

async function newFile() {
    const sel = state.selected;
    const folder = sel ? (sel.endsWith('/') ? sel : sel.substring(0, sel.lastIndexOf('/') + 1)) : '';
    const path = await prompt('New file', {
        value: folder,
        placeholder: 'folder/name.ext',
        okLabel: 'Create',
        description: 'Path relative to the repository root. Missing folders are created.',
    });
    if (!path || path.endsWith('/')) return;
    if (state.files.includes(path)) {
        await openFile(path);
        return;
    }
    await busy(`create ${path}`, () => git('writefile', { path, contents: '' }));
    for (let i = path.indexOf('/'); i > -1; i = path.indexOf('/', i + 1)) {
        state.expanded.add(path.substring(0, i + 1));
    }
    state.selected = path;
    await refreshTree();
    await openFile(path);
}

async function deletePath(path) {
    const isDir = path.endsWith('/');
    const ok = await confirm(`Delete ${path}?`,
        isDir ? 'The folder and everything in it is removed from the working tree. Commit to record the deletion.'
            : 'The file is removed from the working tree. Commit to record the deletion.',
        'Delete');
    if (!ok) return;
    await busy(`delete ${path}`, () => git('deletepath', { path: path.replace(/\/$/, '') }));
    for (const tab of [...state.tabs]) {
        if (tab.path === path || (isDir && tab.path.startsWith(path))) closeTab(tab.path, true);
    }
    await refreshTree();
}

// ---- tabs and editor -------------------------------------------------------

const editor = new Editor($('editorpane'), {
    onChange: (text) => {
        const tab = activeTab();
        if (!tab) return;
        const dirty = text !== tab.saved;
        if (dirty !== tab.dirty) {
            tab.dirty = dirty;
            renderTabs();
        }
        schedulePreview();
    },
    onSave: () => quiet(save()),
});

const activeTab = () => state.tabs.find(t => t.path === state.active);

async function openFile(path) {
    let tab = state.tabs.find(t => t.path === path);
    if (!tab) {
        const contents = await busy(`open ${path}`, () => git('readfile', { path }));
        tab = { path, saved: contents, dirty: false };
        state.tabs.push(tab);
    }
    await activate(path);
}

async function activate(path) {
    const tab = state.tabs.find(t => t.path === path);
    state.active = path;
    state.selected = path;
    updateWorkspace();
    renderTabs();
    renderTree();
    if (tab) await editor.show(path, tab.saved);
    updatePreview();
}

function closeTab(path, force = false) {
    const index = state.tabs.findIndex(t => t.path === path);
    if (index === -1) return;
    const tab = state.tabs[index];
    if (tab.dirty && !force && !window.confirm(`Discard unsaved changes to ${path}?`)) return;
    state.tabs.splice(index, 1);
    editor.forget(path);
    if (state.active === path) {
        const next = state.tabs[Math.min(index, state.tabs.length - 1)];
        state.active = null;
        if (next) {
            quiet(activate(next.path));
            return;
        }
    }
    updateWorkspace();
    renderTabs();
}

function renderTabs() {
    const list = $('tablist');
    list.innerHTML = '';
    for (const tab of state.tabs) {
        const name = tab.path.split('/').pop();
        list.append(h('div', {
            class: `tab ${tab.path === state.active ? 'active' : ''} ${tab.dirty ? 'dirty' : ''}`,
            title: tab.path,
            onclick: () => quiet(activate(tab.path)),
            onauxclick: (e) => { if (e.button === 1) closeTab(tab.path); },
        },
            h('span', {}, name),
            h('span', {
                class: 'close',
                role: 'button',
                'aria-label': `Close ${tab.path}`,
                onclick: (e) => { e.stopPropagation(); closeTab(tab.path); },
            })));
    }
    const tab = activeTab();
    $('savebutton').disabled = !tab?.dirty;
    $('previewbutton').hidden = !tab || !previewable(tab.path);
    $('previewbutton').classList.toggle('primary', state.preview);
}

function updateWorkspace() {
    const hasEditor = state.cloned && !!state.active;
    $('welcome').hidden = hasEditor;
    $('editorpane').hidden = !hasEditor;
    $('tabs').hidden = !state.cloned;
}

async function save() {
    const tab = activeTab();
    if (!tab || !tab.dirty) return;
    const text = editor.text;
    await busy(`save ${tab.path}`, () => git('writefile', { path: tab.path, contents: text }));
    tab.saved = text;
    tab.dirty = editor.text !== text;
    renderTabs();
    await refreshTree();
}

/** After pull: reload open files that changed on disk, unless they have unsaved edits. */
async function reloadOpenFiles() {
    for (const tab of [...state.tabs]) {
        let contents;
        try {
            contents = await git('readfile', { path: tab.path });
        } catch (e) {
            if (!tab.dirty) closeTab(tab.path, true);
            continue;
        }
        if (contents === tab.saved) continue;
        if (tab.dirty) {
            log(`${tab.path} changed on the server; your unsaved edits are kept. Saving will overwrite the merged version.`, 'err');
            showOutput();
            tab.saved = contents;
        } else {
            tab.saved = contents;
            await editor.reset(tab.path, contents);
        }
    }
    renderTabs();
    updatePreview();
}

// ---- preview ---------------------------------------------------------------

const previewable = (path) => ['md', 'markdown', 'html', 'htm'].includes(extensionOf(path));

let markedPromise;
let previewTimer;

function schedulePreview() {
    if (!state.preview) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 300);
}

async function updatePreview() {
    const tab = activeTab();
    const frame = $('preview');
    const show = state.preview && tab && previewable(tab.path);
    frame.hidden = !show;
    $('workspace').classList.toggle('previewing', !!show);
    if (!show) return;
    const text = editor.text;
    if (extensionOf(tab.path).startsWith('htm')) {
        // Scripts may run, but in an opaque origin with no access to this page or its storage.
        frame.sandbox = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';
        frame.srcdoc = text;
    } else {
        markedPromise ??= import('https://cdn.jsdelivr.net/npm/marked@18.3.0/+esm');
        const { marked } = await markedPromise;
        frame.sandbox = 'allow-popups allow-popups-to-escape-sandbox';
        frame.srcdoc = `<!doctype html><meta charset="utf-8"><base target="_blank">
<style>
body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 820px; margin: 24px auto; padding: 0 24px; color: #1f2328; }
pre, code { font-family: ui-monospace, Menlo, monospace; font-size: 14px; background: #f3f4f6; border-radius: 4px; }
pre { padding: 12px; overflow: auto; } code { padding: 1px 4px; } pre code { padding: 0; }
img { max-width: 100%; } table { border-collapse: collapse; } td, th { border: 1px solid #d0d7de; padding: 4px 10px; }
blockquote { margin: 0; padding-left: 14px; border-left: 4px solid #d0d7de; color: #59636e; }
</style>${marked.parse(text)}`;
    }
}

$('previewbutton').onclick = () => {
    state.preview = !state.preview;
    renderTabs();
    updatePreview();
};

// ---- commit / pull / push --------------------------------------------------

async function commit({ pushAfter = false } = {}) {
    await refreshTree();
    const changes = changedPaths();
    const unsaved = state.tabs.filter(t => t.dirty);
    if (changes.length === 0) {
        await alert('Nothing to commit',
            h('p', {}, unsaved.length ? 'Save your files first; only saved changes are committed.' : 'The working tree is clean.'));
        return;
    }
    const result = await dialog((el, close) => {
        const message = h('textarea', { placeholder: 'Commit message', autofocus: true });
        const submit = (push) => {
            if (!message.value.trim()) {
                message.focus();
                return;
            }
            close({ message: message.value.trim(), push });
        };
        message.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(pushAfter);
        });
        el.append(
            h('h3', {}, 'Commit changes'),
            h('div', { class: 'changes' },
                changes.map(path => h('div', { class: `status-${statusOf(path)}` },
                    h('span', { class: 'badge' }, statusOf(path), ' '), h('span', { class: 'name' }, path)))),
            unsaved.length ? h('p', { class: 'warning' },
                `Unsaved changes in ${unsaved.map(t => t.path).join(', ')} will not be included.`) : null,
            message,
            h('div', { class: 'buttons' },
                h('button', { type: 'button', onclick: () => close(null) }, 'Cancel'),
                h('button', { type: 'button', onclick: () => submit(false) }, 'Commit'),
                h('button', { type: 'button', class: 'primary', onclick: () => submit(true) }, 'Commit & Push')));
    });
    if (!result) return;
    await busy('git commit', () => git('commit', { message: result.message }));
    await refreshTree();
    if (result.push) await push();
}

async function pull() {
    await busy('git pull', async () => {
        await configureUser();
        const result = await git('pull');
        if (!result.merged) log(result.message);
    });
    await refreshTree();
    await reloadOpenFiles();
}

async function push() {
    if (changedPaths().length > 0) {
        log('Uncommitted changes are not pushed. Commit them first to include them.');
    }
    await busy('git push', async () => {
        await configureUser();
        await git('push');
    });
    await refreshTree();
    await reloadOpenFiles();
    $('statusline').textContent = 'Pushed';
}

// ---- menus -----------------------------------------------------------------

function popupMenu(anchor, items) {
    document.querySelector('.menu')?.remove();
    const menu = h('div', { class: 'menu', role: 'menu' },
        items.map(item => item === '-' ? h('hr') : h('button', {
            role: 'menuitem',
            onclick: () => { menu.remove(); quiet(Promise.resolve().then(item.action)); },
        }, item.label)));
    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }));
}

$('repomenubutton').onclick = (e) => popupMenu(e.currentTarget, [
    { label: 'Log', action: () => busy('git log', async () => { log(await git('log')); showOutput(); }) },
    { label: 'Diff of unstaged changes', action: () => busy('git diff', async () => { log(await git('diff') || '(no unstaged changes)'); showOutput(); }) },
    '-',
    { label: 'New repository…', action: newRepository },
    { label: 'Set permissions…', action: setPermissions },
    { label: 'Terminal git access…', action: terminalAccess },
    '-',
    { label: 'Delete local clone…', action: deleteLocal },
]);

async function deleteLocal() {
    const ok = await confirm(`Delete the local clone of ${repoName()}?`,
        'Uncommitted and unpushed changes are lost. The repository on the server is not affected.', 'Delete');
    if (!ok) return;
    await busy('delete local clone', () => git('deletelocal'));
    for (const tab of [...state.tabs]) closeTab(tab.path, true);
    setCloned(false);
}

// ---- NEAR account ------------------------------------------------------------

function renderAccount() {
    const accountId = near.currentAccountId();
    $('accountbutton').textContent = accountId || 'Sign in';
    $('accountbutton').title = accountId ? `Signed in as ${accountId}` : 'Sign in with a NEAR wallet';
}

$('accountbutton').onclick = (e) => {
    if (!near.currentAccountId()) {
        quiet(signIn());
        return;
    }
    popupMenu(e.currentTarget, [
        { label: 'Terminal git access…', action: terminalAccess },
        { label: 'Sign out', action: signOut },
    ]);
};

async function signIn() {
    const ok = await confirm('Sign in with NEAR',
        'Your wallet will ask you to approve adding an access key to your account. ' +
        'The key stays in this browser and is only used to sign access tokens for this git server. ' +
        'It can only call the view method get_permission on wasmgit.near, with an allowance of 0.01 NEAR for gas.',
        'Continue');
    if (!ok) return;
    const accountId = await busy('sign in', () => near.signIn());
    log(`signed in as ${accountId}`);
    renderAccount();
    await configureUser();
}

async function signOut() {
    await near.signOut();
    renderAccount();
    await configureUser();
    log('signed out. The access key remains on your account; you can remove it in your wallet.');
}

async function requireSignIn(what) {
    if (near.currentAccountId()) return true;
    const ok = await confirm('Sign in required', `${what} requires signing in with a NEAR account.`, 'Sign in');
    if (ok) await signIn();
    return !!near.currentAccountId();
}

async function newRepository() {
    if (!await requireSignIn('Creating a repository')) return;
    const name = await dialog((el, close) => {
        const input = h('input', { type: 'text', placeholder: 'repository name', autofocus: true });
        el.append(h('form', { onsubmit: (e) => { e.preventDefault(); close(input.value.trim() || null); } },
            h('h3', {}, 'Reserve repository name'),
            h('p', {}, 'This sets your account as owner of the repository, provided the name is not already taken.'),
            h('ul', {},
                h('li', {}, 'You are charged 0.1 NEAR for the name (storage is not included).'),
                h('li', {}, 'Keep your repositories small (max 10MB).'),
                h('li', {}, 'Storage costs may be introduced in the future.'),
                h('li', {}, 'Repositories on the server may be deleted, so keep a backup of your own.')),
            input,
            h('div', { class: 'buttons' },
                h('button', { type: 'button', onclick: () => close(null) }, 'Cancel'),
                h('button', { type: 'submit', class: 'primary' }, 'Create'))));
    });
    if (!name) return;
    await busy(`reserve ${name}`, () => near.setPermission(name, 'owner'));
    const url = `${location.origin}/${name}`;
    log(`reserved ${name}. Clone ${url} to start working in it.`);
    $('repourl').value = url;
    await openRepository(url);
}

async function setPermissions() {
    if (!await requireSignIn('Setting permissions')) return;
    const repo = repoName();
    const result = await dialog((el, close) => {
        const account = h('input', { type: 'text', placeholder: 'NEAR account id', autofocus: true });
        const permission = h('select', {},
            ['contributor', 'reader', 'owner', 'none'].map(p => h('option', { value: p }, p)));
        el.append(h('form', {
            onsubmit: (e) => {
                e.preventDefault();
                if (account.value.trim()) close({ accountId: account.value.trim(), permission: permission.value });
            },
        },
            h('h3', {}, `Permissions for ${repo}`),
            h('p', {}, 'Set the permission an account has on this repository. You are charged 0.1 NEAR. Use the account ANONYMOUS to control public read access.'),
            account,
            permission,
            h('div', { class: 'buttons' },
                h('button', { type: 'button', onclick: () => close(null) }, 'Cancel'),
                h('button', { type: 'submit', class: 'primary' }, 'Update'))));
    });
    if (!result) return;
    await busy(`set ${result.permission} for ${result.accountId} on ${repo}`,
        () => near.setPermission(repo, result.permission, result.accountId));
}

async function terminalAccess() {
    if (!await requireSignIn('Terminal git access')) return;
    const token = await near.createAccessToken();
    const snippet = (text) => {
        const pre = h('pre', {}, text);
        return h('div', {}, pre, h('button', {
            type: 'button',
            onclick: (e) => {
                navigator.clipboard.writeText(text);
                e.currentTarget.textContent = 'Copied';
            },
        }, 'Copy'));
    };
    await alert('Terminal git access',
        h('p', {}, 'Clone'),
        snippet(`git clone -c http.extraheader="Authorization: Bearer ${token}" ${state.url}`),
        h('p', {}, 'Configure the token in an existing clone'),
        snippet(`git config http.extraheader "Authorization: Bearer ${token}"`),
        h('p', { class: 'warning' }, 'The token is valid for 24 hours.'));
}

// ---- wiring ----------------------------------------------------------------

$('repoform').onsubmit = (e) => {
    e.preventDefault();
    quiet(clone());
};
$('repourl').onchange = () => {
    const url = $('repourl').value.trim();
    if (url && url !== state.url) quiet(openRepository(url));
};
$('pullbutton').onclick = () => quiet(pull());
$('commitbutton').onclick = () => quiet(commit());
$('pushbutton').onclick = () => quiet(push());
$('newfilebutton').onclick = () => quiet(newFile());
$('refreshbutton').onclick = () => quiet(refreshTree());
$('savebutton').onclick = () => quiet(save());

const mobile = window.matchMedia('(max-width: 700px)');
$('sidebartoggle').onclick = () => {
    document.body.classList.toggle(mobile.matches ? 'sidebar-open' : 'sidebar-hidden');
};
$('tree').addEventListener('click', (e) => {
    if (mobile.matches && e.target.closest('.row') && !e.target.closest('.row').querySelector('.twisty')?.textContent) {
        document.body.classList.remove('sidebar-open');
    }
});

window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        quiet(save());
    }
});

window.addEventListener('beforeunload', (e) => {
    if (state.tabs.some(t => t.dirty)) e.preventDefault();
});

renderAccount();
renderTabs();
const initialUrl = localStorage.getItem('lastRemoteUrl') || `${location.origin}/test`;
$('repourl').value = initialUrl;
setCloned(false);
quiet(busy('open local clone', async () => {
    await configureUser();
    await openRepository(initialUrl);
}));
