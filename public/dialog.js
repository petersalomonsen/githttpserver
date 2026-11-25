// Small modal dialogs on top of <dialog>.
//
// `dialog(build)` opens a dialog; `build(body, close)` fills `body` and calls
// `close(value)` to resolve. Escape resolves with null.

export function dialog(build) {
    return new Promise(resolve => {
        const el = document.createElement('dialog');
        el.className = 'dialog';
        // Let builders pass optional (null/false) children.
        const append = el.append.bind(el);
        el.append = (...nodes) => append(...nodes.filter(n => n != null && n !== false));
        let settled = false;
        const close = (value) => {
            if (settled) return;
            settled = true;
            el.close();
            el.remove();
            resolve(value);
        };
        el.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
        build(el, close);
        document.body.appendChild(el);
        el.showModal();
        const autofocus = el.querySelector('[autofocus]') || el.querySelector('input, textarea, select');
        autofocus?.focus();
    });
}

export function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'class') el.className = value;
        else if (key.startsWith('on')) el.addEventListener(key.substring(2), value);
        else if (value === true) el.setAttribute(key, '');
        else if (value !== false && value != null) el.setAttribute(key, value);
    }
    for (const child of children.flat()) {
        if (child == null || child === false) continue;
        el.append(child instanceof Node ? child : String(child));
    }
    return el;
}

/** Ask for one line of text. Resolves with the text, or null if cancelled. */
export function prompt(title, { value = '', placeholder = '', okLabel = 'OK', description } = {}) {
    return dialog((el, close) => {
        const input = h('input', { type: 'text', value, placeholder, autofocus: true });
        const form = h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); close(input.value.trim() || null); } },
            h('h3', {}, title),
            description ? h('p', {}, description) : null,
            input,
            h('div', { class: 'buttons' },
                h('button', { type: 'button', onclick: () => close(null) }, 'Cancel'),
                h('button', { type: 'submit', class: 'primary' }, okLabel)));
        el.append(form);
    });
}

export function confirm(title, description, okLabel = 'OK') {
    return dialog((el, close) => {
        el.append(
            h('h3', {}, title),
            description ? h('p', {}, description) : null,
            h('div', { class: 'buttons' },
                h('button', { type: 'button', onclick: () => close(false) }, 'Cancel'),
                h('button', { type: 'button', class: 'primary', autofocus: true, onclick: () => close(true) }, okLabel)));
    });
}

export function alert(title, ...content) {
    return dialog((el, close) => {
        el.append(
            h('h3', {}, title),
            ...content,
            h('div', { class: 'buttons' },
                h('button', { type: 'button', class: 'primary', autofocus: true, onclick: () => close(true) }, 'Close')));
    });
}
