// CodeMirror 6 from esm.sh. Every package resolves its @codemirror/* and
// @lezer/* dependencies to the same esm.sh URLs, so there is one copy of
// @codemirror/state on the page (two copies break extension checks).

import { basicSetup } from 'https://esm.sh/codemirror@6.0.2';
import { EditorView, keymap } from 'https://esm.sh/@codemirror/view@6';
import { EditorState, Compartment } from 'https://esm.sh/@codemirror/state@6';
import { indentWithTab } from 'https://esm.sh/@codemirror/commands@6';
import { oneDark } from 'https://esm.sh/@codemirror/theme-one-dark@6';

const languageLoaders = {
    js: () => import('https://esm.sh/@codemirror/lang-javascript@6').then(m => m.javascript()),
    mjs: () => import('https://esm.sh/@codemirror/lang-javascript@6').then(m => m.javascript()),
    cjs: () => import('https://esm.sh/@codemirror/lang-javascript@6').then(m => m.javascript()),
    jsx: () => import('https://esm.sh/@codemirror/lang-javascript@6').then(m => m.javascript({ jsx: true })),
    ts: () => import('https://esm.sh/@codemirror/lang-javascript@6').then(m => m.javascript({ typescript: true })),
    tsx: () => import('https://esm.sh/@codemirror/lang-javascript@6').then(m => m.javascript({ jsx: true, typescript: true })),
    json: () => import('https://esm.sh/@codemirror/lang-json@6').then(m => m.json()),
    html: () => import('https://esm.sh/@codemirror/lang-html@6').then(m => m.html()),
    htm: () => import('https://esm.sh/@codemirror/lang-html@6').then(m => m.html()),
    css: () => import('https://esm.sh/@codemirror/lang-css@6').then(m => m.css()),
    md: () => import('https://esm.sh/@codemirror/lang-markdown@6').then(m => m.markdown()),
    markdown: () => import('https://esm.sh/@codemirror/lang-markdown@6').then(m => m.markdown()),
    py: () => import('https://esm.sh/@codemirror/lang-python@6').then(m => m.python()),
    rs: () => import('https://esm.sh/@codemirror/lang-rust@6').then(m => m.rust()),
    xml: () => import('https://esm.sh/@codemirror/lang-xml@6').then(m => m.xml()),
    svg: () => import('https://esm.sh/@codemirror/lang-xml@6').then(m => m.xml()),
    yaml: () => import('https://esm.sh/@codemirror/lang-yaml@6').then(m => m.yaml()),
    yml: () => import('https://esm.sh/@codemirror/lang-yaml@6').then(m => m.yaml()),
};

export function extensionOf(path) {
    const name = path.split('/').pop();
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.substring(dot + 1).toLowerCase() : '';
}

/**
 * One editor view whose document is swapped per open file. Each file keeps
 * its own EditorState, so undo history and cursor survive switching files.
 */
export class Editor {
    constructor(parent, { onChange, onSave }) {
        this.onChange = onChange;
        this.onSave = onSave;
        this.states = new Map();
        this.language = new Compartment();
        this.view = new EditorView({ parent, state: this.createState('') });
    }

    createState(doc) {
        return EditorState.create({
            doc,
            extensions: [
                basicSetup,
                keymap.of([
                    indentWithTab,
                    { key: 'Mod-s', preventDefault: true, run: () => { this.onSave(); return true; } },
                ]),
                oneDark,
                this.language.of([]),
                EditorView.updateListener.of(update => {
                    if (update.docChanged) this.onChange(this.view.state.doc.toString());
                }),
                EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
            ],
        });
    }

    /** Show a file, creating its state from `contents` the first time. */
    async show(path, contents) {
        if (this.currentPath && this.currentPath !== path) {
            this.states.set(this.currentPath, this.view.state);
        }
        this.currentPath = path;
        let state = this.states.get(path);
        const isNew = !state;
        if (isNew) {
            state = this.createState(contents);
        }
        this.view.setState(state);
        if (isNew) {
            const loader = languageLoaders[extensionOf(path)];
            if (loader) {
                try {
                    const lang = await loader();
                    if (this.currentPath === path) {
                        this.view.dispatch({ effects: this.language.reconfigure(lang) });
                    }
                } catch (e) {
                    console.warn('could not load language support for', path, e);
                }
            }
        }
        this.view.focus();
    }

    /** Replace a file's contents (reloaded from disk), dropping its undo history. */
    async reset(path, contents) {
        this.states.delete(path);
        if (this.currentPath === path) {
            this.currentPath = null;
            await this.show(path, contents);
        }
    }

    /** Forget a file's state (closed). */
    forget(path) {
        this.states.delete(path);
        if (this.currentPath === path) {
            this.currentPath = null;
            this.view.setState(this.createState(''));
        }
    }

    get text() {
        return this.view.state.doc.toString();
    }

    /** The selected text in the current file, with its line range, or null. */
    get selection() {
        const { state } = this.view;
        const range = state.selection.main;
        if (range.empty) return null;
        return {
            text: state.sliceDoc(range.from, range.to),
            fromLine: state.doc.lineAt(range.from).number,
            toLine: state.doc.lineAt(range.to).number,
        };
    }
}
