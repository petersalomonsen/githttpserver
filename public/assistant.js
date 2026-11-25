// The AI assistant panel: a chat with a NEAR AI model that works on the
// repository through tools backed by the git worker.
//
// Edits go straight to the working tree as uncommitted changes; the user
// reviews them (tree markers, diff, discard) and commits what they keep.

import { dialog, h } from './dialog.js';
import { fileDiff, diffStat, renderDiff } from './diff.js';
import * as near from './near.js';
import {
    NEAR_AI_BASE_URL, DEFAULT_SPEND_LIMIT_USD, checkKey, connectWithWallet, fetchChatModels,
    loadAccount, storeAccount, forgetAccount,
} from './nearai/account.js';
import {
    DEFAULT_MODEL, SYSTEM_PROMPT, COMPACT_AT_CHARS, applyEdit, numberLines, runAgentTurn,
    compactConversation, conversationChars,
} from './nearai/agent.js';

const MODEL_STORAGE = 'githttpserver:nearai-model';
const $ = (id) => document.getElementById(id);

let ide;
let messages = [];
let abort = null;
let renderMarkdown;

export function initAssistant(api) {
    ide = api;
    $('assistanttoggle').onclick = () => togglePanel();
    $('assistantclose').onclick = () => togglePanel(false);
    $('assistantmenu').onclick = (e) => ide.popupMenu(e.currentTarget, [
        { label: 'New chat', action: newChat },
        { label: 'NEAR AI account…', action: accountDialog },
    ]);
    $('assistantform').onsubmit = (e) => {
        e.preventDefault();
        if (abort) abort.abort();
        else send();
    };
    $('assistantinput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            if (!abort) send();
        }
    });
    $('assistantconnect').onclick = () => accountDialog();
    $('assistantmodel').onchange = () => localStorage.setItem(MODEL_STORAGE, $('assistantmodel').value);
    if (localStorage.getItem('githttpserver:assistant-open') === 'true') togglePanel(true);
}

function togglePanel(open = document.body.classList.contains('assistant-hidden')) {
    document.body.classList.toggle('assistant-hidden', !open);
    localStorage.setItem('githttpserver:assistant-open', String(open));
    if (open) {
        renderAccountState();
        loadModels();
        $('assistantinput').focus();
    }
}

// ---- account and models ------------------------------------------------------

function renderAccountState() {
    const account = loadAccount();
    $('assistantconnect').hidden = !!account;
    $('assistantform').hidden = !account;
}

let modelsLoaded = false;
async function loadModels() {
    if (modelsLoaded) return;
    const select = $('assistantmodel');
    const stored = localStorage.getItem(MODEL_STORAGE);
    try {
        const models = await fetchChatModels();
        modelsLoaded = true;
        select.innerHTML = '';
        for (const m of models) select.append(h('option', { value: m.id }, m.name));
        const preferred = [stored, DEFAULT_MODEL].find(id => id && models.some(m => m.id === id));
        select.value = preferred ?? models[0]?.id ?? '';
    } catch (e) {
        select.innerHTML = '';
        select.append(h('option', { value: stored || DEFAULT_MODEL }, stored || DEFAULT_MODEL));
        ide.log(`could not list NEAR AI models: ${e.message}`, 'err');
    }
}

async function accountDialog() {
    const account = loadAccount();
    await dialog((el, close) => {
        const status = h('p', { class: 'status' });
        const say = (text, cls = '') => { status.textContent = text; status.className = `status ${cls}`; };
        if (account) {
            el.append(
                h('h3', {}, 'NEAR AI account'),
                h('p', {}, account.accountId ? `Connected as ${account.accountId}.` : 'Using a pasted API key.'),
                h('p', {}, 'The key is stored in this browser only. To revoke it, delete it at ',
                    h('a', { href: 'https://cloud.near.ai', target: '_blank', rel: 'noopener' }, 'cloud.near.ai'), '.'),
                status,
                h('div', { class: 'buttons' },
                    h('button', {
                        type: 'button', onclick: async () => {
                            say('Checking…');
                            const result = await checkKey(account.key);
                            say({ ok: 'The key works.', 'no-credits': 'The key works, but the account has no credits. Add them at cloud.near.ai.', invalid: 'The key is not valid any more. Disconnect and connect again.', unknown: 'Could not reach NEAR AI.' }[result], result === 'ok' ? 'ok' : 'warning');
                        },
                    }, 'Check key'),
                    h('button', { type: 'button', onclick: () => { forgetAccount(); renderAccountState(); close(true); } }, 'Disconnect'),
                    h('button', { type: 'button', class: 'primary', onclick: () => close(true) }, 'Close')));
            return;
        }
        const limit = h('input', { type: 'number', min: '0.5', step: '0.5', value: String(DEFAULT_SPEND_LIMIT_USD) });
        const walletButton = h('button', { type: 'button', class: 'primary' }, 'Connect NEAR wallet');
        const key = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-…' });

        const signIn = async () => {
            walletButton.disabled = true;
            try {
                say('Approve the message in your wallet…');
                const result = await connectWithWallet({
                    signMessage: near.signMessage,
                    spendLimitUsd: Number(limit.value) || DEFAULT_SPEND_LIMIT_USD,
                });
                storeAccount(result);
                renderAccountState();
                close(true);
                ide.log(`NEAR AI: connected as ${result.accountId}${result.status === 'no-credits' ? ' (no credits yet: add them at cloud.near.ai)' : ''}`);
            } catch (e) {
                say(e.message, 'warning');
                walletButton.disabled = false;
            }
        };
        walletButton.onclick = async () => {
            if (await near.connectedWallet()) return signIn();
            walletButton.disabled = true;
            try {
                say('Choose a wallet…');
                await near.connectWallet();
                // Signing needs its own click: wallets block popups without one.
                say('Wallet connected. Now sign the NEAR AI sign-in message.');
                walletButton.textContent = 'Sign in to NEAR AI';
                walletButton.onclick = signIn;
            } catch (e) {
                say(`Could not connect: ${e.message}`, 'warning');
            }
            walletButton.disabled = false;
        };

        el.append(
            h('h3', {}, 'Connect a NEAR AI account'),
            h('p', {}, 'The assistant runs on your own NEAR AI credits and talks to NEAR AI directly from this browser.'),
            h('h4', {}, 'With a NEAR wallet'),
            h('p', {}, 'You sign one message (no transaction). That creates an API key for this site with a spending limit, which expires after 90 days.'),
            h('label', {}, 'Spending limit (USD) ', limit),
            h('div', { class: 'buttons start' }, walletButton),
            h('h4', {}, 'Or paste an API key'),
            h('p', {}, 'Create one at ', h('a', { href: 'https://cloud.near.ai', target: '_blank', rel: 'noopener' }, 'cloud.near.ai'),
                '. It stays in this browser.'),
            h('form', {
                onsubmit: async (e) => {
                    e.preventDefault();
                    const value = key.value.trim();
                    if (!value) return;
                    say('Checking the key…');
                    const result = await checkKey(value);
                    if (result === 'invalid') {
                        say('NEAR AI does not accept this key.', 'warning');
                        return;
                    }
                    storeAccount({ key: value });
                    renderAccountState();
                    close(true);
                    if (result === 'no-credits') ide.log('NEAR AI: the key works, but the account has no credits yet.', 'err');
                },
            }, key, h('div', { class: 'buttons start' }, h('button', { type: 'submit' }, 'Use this key'))),
            status,
            h('div', { class: 'buttons' }, h('button', { type: 'button', onclick: () => close(false) }, 'Cancel')));
    });
}

// ---- chat --------------------------------------------------------------------

function newChat() {
    if (abort) abort.abort();
    messages = [];
    $('assistantmessages').innerHTML = '';
}

function scrollToEnd() {
    const list = $('assistantmessages');
    list.scrollTop = list.scrollHeight;
}

function addMessage(cls, ...content) {
    const el = h('div', { class: `msg ${cls}` }, ...content);
    $('assistantmessages').append(el);
    scrollToEnd();
    return el;
}

async function markdown(text) {
    renderMarkdown ??= Promise.all([
        import('https://cdn.jsdelivr.net/npm/marked@18.3.0/+esm'),
        import('https://cdn.jsdelivr.net/npm/dompurify@3/+esm'),
    ]).then(([{ marked }, { default: DOMPurify }]) => (md) => {
        // Model output can echo text from the repository, so it is sanitised.
        // Nothing may load: an image URL written by a prompt-injected model
        // could carry repository contents to someone else's server.
        const div = document.createElement('div');
        div.innerHTML = DOMPurify.sanitize(marked.parse(md), {
            FORBID_TAGS: ['style', 'form', 'input', 'img', 'picture', 'source', 'video', 'audio', 'iframe', 'object', 'embed', 'link', 'svg'],
        });
        for (const a of div.querySelectorAll('a')) {
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
        }
        return div;
    });
    return (await renderMarkdown)(text);
}

/** What the user is looking at, sent along with their message. */
function editorContext() {
    const { path, selection } = ide.activeFile();
    const tabs = ide.openTabs();
    const lines = [`Repository: ${ide.repoName()}`];
    if (path) lines.push(`Active file in the editor: ${path}`);
    const dirty = tabs.filter(t => t.dirty).map(t => t.path);
    if (dirty.length) lines.push(`Files with unsaved edits (you cannot change these): ${dirty.join(', ')}`);
    if (selection) {
        const text = selection.text.length > 4000 ? selection.text.substring(0, 4000) + '\n…' : selection.text;
        lines.push(`Selected in ${path}, lines ${selection.fromLine}-${selection.toLine}:\n\`\`\`\n${text}\n\`\`\``);
    }
    return lines.join('\n');
}

async function send() {
    const input = $('assistantinput');
    const text = input.value.trim();
    const account = loadAccount();
    if (!text) return;
    if (!account) {
        accountDialog();
        return;
    }
    if (!ide.isCloned()) {
        addMessage('error', 'Clone a repository first.');
        return;
    }
    input.value = '';
    addMessage('user', text);
    if (messages.length === 0) messages.push({ role: 'system', content: SYSTEM_PROMPT });
    messages.push({ role: 'user', content: `${text}\n\n<context>\n${editorContext()}\n</context>` });

    abort = new AbortController();
    setRunning(true);
    const model = $('assistantmodel').value || DEFAULT_MODEL;
    const thinking = addMessage('thinking', 'Thinking…');
    try {
        if (conversationChars(messages) > COMPACT_AT_CHARS) {
            thinking.textContent = 'Summarising the conversation so far…';
            const last = messages.pop();
            messages = await compactConversation({ baseUrl: NEAR_AI_BASE_URL, apiKey: account.key, model, messages, signal: abort.signal });
            messages.push(last);
        }
        const result = await runAgentTurn({
            baseUrl: NEAR_AI_BASE_URL,
            apiKey: account.key,
            model,
            messages,
            signal: abort.signal,
            runTool,
            onText: (t) => {
                const el = h('div', { class: 'msg assistant' });
                thinking.before(el);
                markdown(t).then((node) => { el.append(node); scrollToEnd(); }, () => { el.textContent = t; });
            },
            onToolCall: (name, args) => {
                thinking.before(toolLine(name, args));
                scrollToEnd();
            },
            onToolResult: (name, args, res) => {
                if (typeof res === 'string' && res.startsWith('ERROR')) {
                    thinking.before(h('div', { class: 'msg tool error' }, res.substring(0, 300)));
                }
            },
            onRetry: (why, delay) => { thinking.textContent = `NEAR AI is busy (${why}), retrying in ${delay / 1000}s…`; },
        });
        if (!result.answered) {
            addMessage('error', result.finishReason === 'length'
                ? 'The answer was cut off (too long). Ask it to continue, or to be briefer.'
                : 'The model ended its turn without an answer.');
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            addMessage('error', 'Stopped.');
        } else if (e.outOfCredits) {
            addMessage('error', 'Your NEAR AI account is out of credits. Add credits at cloud.near.ai, then try again.');
        } else if (e.badKey) {
            addMessage('error', 'NEAR AI did not accept the key. Connect your account again (⋯ → NEAR AI account).');
        } else {
            addMessage('error', e.message);
        }
        // Keep the history valid: drop a trailing assistant message whose tool calls never got results.
        while (messages.length && messages.at(-1).role === 'assistant' && messages.at(-1).tool_calls?.length) messages.pop();
    } finally {
        thinking.remove();
        abort = null;
        setRunning(false);
    }
}

function setRunning(running) {
    $('assistantsend').textContent = running ? 'Stop' : 'Send';
    $('assistantsend').classList.toggle('primary', !running);
}

function toolLine(name, args) {
    const path = args.path ? ` ${args.path}` : '';
    const label = {
        list_files: `list files${path}`,
        read_file: `read${path}${args.start_line ? ` lines ${args.start_line}-${args.end_line ?? ''}` : ''}`,
        grep: `grep /${args.pattern}/${path}`,
        edit_file: `edit${path}`,
        write_file: `write${path}`,
        delete_file: `delete${path}`,
        git_status: 'git status',
        git_diff: `diff${path}`,
        git_log: 'git log',
        open_file: `open${path}`,
    }[name] ?? name;
    return h('div', { class: 'msg tool' }, `› ${label}`);
}

// ---- tools -------------------------------------------------------------------

function assertWritable(path) {
    if (ide.openTabs().some(t => t.path === path && t.dirty)) {
        throw new Error(`the user has unsaved edits in ${path}. Ask them to save or close it first.`);
    }
}

/** Show an edited file in the chat with its diff stat; click for the full diff. */
async function reportChange(path) {
    await ide.refreshTree();
    await ide.reloadOpenFiles();
    const patch = await fileDiff(ide.git, path).catch(() => '');
    const { added, removed } = diffStat(patch);
    const line = h('div', { class: 'msg change' },
        h('button', { class: 'link', title: 'Show diff', onclick: () => ide.showDiff(path) }, `✎ ${path}`),
        h('span', { class: 'add' }, ` +${added}`),
        h('span', { class: 'del' }, ` −${removed}`));
    $('assistantmessages').querySelector('.msg.thinking')?.before(line);
    return patch;
}

const toolHandlers = {
    async list_files({ path = '' }) {
        const { files, status } = await ide.git('tree');
        const prefix = path.replace(/^\/+|\/+$/g, '');
        const listed = files.filter(f => !prefix || f === prefix + '/' || f.startsWith(prefix + '/'));
        for (const [p, xy] of Object.entries(status)) {
            if (xy.includes('D') && !listed.includes(p) && (!prefix || p.startsWith(prefix + '/'))) listed.push(p);
        }
        if (!listed.length) return prefix ? `no files under ${prefix}` : 'the repository is empty';
        return listed.sort().map(f => {
            const xy = status[f];
            const mark = !xy ? ' ' : xy === '??' ? 'U' : xy.includes('D') ? 'D' : xy.includes('A') ? 'A' : 'M';
            return `${mark} ${f}`;
        }).join('\n');
    },

    async read_file({ path, start_line, end_line }) {
        const text = await ide.git('readfile', { path });
        const dirty = ide.openTabs().some(t => t.path === path && t.dirty);
        return (dirty ? `(note: the user has unsaved edits to this file in the editor; this is the saved version)\n` : '')
            + numberLines(text, start_line ?? 1, end_line ?? Infinity);
    },

    async grep({ pattern, path, ignore_case }) {
        const { matches, truncated } = await ide.git('grep', { pattern, path, ignoreCase: !!ignore_case });
        if (!matches.length) return 'no matches';
        return matches.map(m => `${m.path}:${m.line}: ${m.text}`).join('\n') + (truncated ? '\n… (more matches; narrow the search)' : '');
    },

    async edit_file({ path, old_text, new_text, replace_all }) {
        assertWritable(path);
        const text = await ide.git('readfile', { path });
        const edited = applyEdit(text, { old_text, new_text, replace_all });
        await ide.git('writefile', { path, contents: edited });
        const patch = await reportChange(path);
        const { added, removed } = diffStat(patch);
        return `edited ${path} (+${added} −${removed} against the last commit)`;
    },

    async write_file({ path, contents }) {
        assertWritable(path);
        await ide.git('writefile', { path, contents });
        await reportChange(path);
        const lines = contents === '' ? 0 : contents.split('\n').length - (contents.endsWith('\n') ? 1 : 0);
        return `wrote ${path} (${lines} lines)`;
    },

    async delete_file({ path }) {
        assertWritable(path);
        await ide.git('deletepath', { path });
        ide.closeTab(path);
        await reportChange(path);
        return `deleted ${path}`;
    },

    async git_status() {
        const status = await ide.git('status');
        const lines = Object.entries(status).map(([p, xy]) => `${xy} ${p}`);
        return lines.length ? lines.join('\n') : 'no uncommitted changes';
    },

    async git_diff({ path }) {
        return (await fileDiff(ide.git, path)) || `${path} has no uncommitted changes`;
    },

    async git_log({ limit = 10 }) {
        const log = await ide.git('log');
        const commits = log.split(/\n(?=commit [0-9a-f]{40})/);
        return commits.slice(0, Math.max(1, Math.min(limit, 50))).join('\n') || 'no commits';
    },

    async open_file({ path }) {
        await ide.openFile(path);
        return `opened ${path} in the editor`;
    },
};

async function runTool(name, args) {
    const handler = toolHandlers[name];
    if (!handler) return `ERROR: there is no tool called ${name}`;
    if ('path' in args && typeof args.path === 'string') args.path = args.path.replace(/^\.?\/+/, '');
    return await handler(args);
}
