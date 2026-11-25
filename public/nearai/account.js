// The user's own NEAR AI account, so the assistant runs on their credits and
// the browser talks to NEAR AI directly: nothing goes through this server.
//
// Inference takes API keys, not sessions. So a wallet signature (NEP-413, no
// transaction) opens a session once, the session creates a key with a spending
// cap and an expiry, and the session is then closed. The key stays in this
// browser's localStorage, never in a repository.
//
// Ported from Ariz-Portfolio (public_html/dataagent/nearai-account.js) and
// javascriptmusic (wasmaudioworklet/near/nearai-account.js).

export const NEAR_AI_BASE_URL = 'https://cloud-api.near.ai/v1';
const SIGN_IN_MESSAGE = 'Sign in to NEAR AI Cloud';
const SIGN_IN_RECIPIENT = 'cloud.near.ai';
const STORAGE_KEY = 'githttpserver:nearai-account';
const KEY_LIFETIME_MILLIS = 90 * 24 * 60 * 60 * 1000;
const KEY_ACTIVATION_ATTEMPTS = 8;
const KEY_ACTIVATION_DELAY_MILLIS = 2000;
const SESSION_MAX_AGE_MILLIS = 10 * 60 * 1000;
export const DEFAULT_SPEND_LIMIT_USD = 5;

const api = (fetchFn, path, token, init = {}) => fetchFn(`${NEAR_AI_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
});

const failure = async (what, response) => {
    const body = await response.json().catch(() => ({}));
    return new Error(`${what} (${response.status})${body?.error?.message ? `: ${body.error.message}` : ''}`);
};

/** NEAR AI's nonce: the time as 8 big-endian bytes, then 24 random ones. */
function signInNonce(nowMillis) {
    const nonce = new Uint8Array(32);
    new DataView(nonce.buffer).setBigUint64(0, BigInt(nowMillis));
    crypto.getRandomValues(nonce.subarray(8));
    return nonce;
}

/** @returns {Promise<'ok'|'no-credits'|'invalid'|'unknown'>} Spends nothing: it runs no inference. */
export async function checkKey(key, { fetchFn = fetch } = {}) {
    try {
        const response = await api(fetchFn, '/check_api_key', key, { method: 'POST' });
        if (response.ok) return 'ok';
        if (response.status === 402) return 'no-credits';
        if (response.status === 401 || response.status === 403) return 'invalid';
    } catch {
        // Could not tell, which is not the same as the key being bad.
    }
    return 'unknown';
}

// Only a session this sign-in opened, never one from another device.
async function closeSession(session, { fetchFn, nowMillis }) {
    const response = await api(fetchFn, '/users/me/refresh-tokens', session);
    if (!response.ok) return;
    const [newest] = (await response.json()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (newest && nowMillis() - new Date(newest.created_at).getTime() < SESSION_MAX_AGE_MILLIS) {
        await api(fetchFn, `/users/me/refresh-tokens/${newest.id}`, session, { method: 'DELETE' });
    }
}

/**
 * One wallet prompt, no transaction. Replaces the key this browser made last time.
 * @param {object} options
 * @param {(params: {message: string, recipient: string, nonce: Uint8Array}) => Promise<{accountId: string, publicKey: string, signature: string}>} options.signMessage
 * @returns {Promise<{key: string, keyId: string, workspaceId: string, accountId: string, status: string}>}
 */
export async function connectWithWallet({
    signMessage, previous = loadAccount(), spendLimitUsd = DEFAULT_SPEND_LIMIT_USD,
    fetchFn = fetch, nowMillis = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
    const nonce = signInNonce(nowMillis());
    const signed = await signMessage({ message: SIGN_IN_MESSAGE, recipient: SIGN_IN_RECIPIENT, nonce });

    const signIn = await api(fetchFn, '/auth/near', null, {
        method: 'POST',
        body: JSON.stringify({
            signed_message: { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature },
            payload: { message: SIGN_IN_MESSAGE, nonce: Array.from(nonce), recipient: SIGN_IN_RECIPIENT },
        }),
    });
    if (!signIn.ok) throw await failure('NEAR AI refused the sign-in', signIn);
    const session = (await signIn.json()).access_token;

    try {
        const me = await api(fetchFn, '/users/me', session);
        if (!me.ok) throw await failure('Could not read your NEAR AI account', me);
        const workspaceId = (await me.json()).workspaces?.[0]?.id;
        if (!workspaceId) throw new Error('Your NEAR AI account has no workspace to create a key in.');

        const suffix = Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) => byte.toString(16).padStart(2, '0')).join('');
        const created = await api(fetchFn, `/workspaces/${workspaceId}/api-keys`, session, {
            method: 'POST',
            body: JSON.stringify({
                name: `wasm-git ${location.host} ${new Date(nowMillis()).toJSON().slice(0, 10)} ${suffix}`,
                // Nano-dollars, from whole cents so no binary fraction gets in.
                spendLimit: { amount: Math.round(spendLimitUsd * 100) * 10_000_000, scale: 9, currency: 'USD' },
                expires_at: new Date(nowMillis() + KEY_LIFETIME_MILLIS).toJSON(),
            }),
        });
        if (!created.ok) throw await failure('Could not create a key', created);
        const { key, id } = await created.json();
        if (!key) throw new Error('NEAR AI did not return the new key.');

        // A failed delete loses nothing: the old key is capped and expires by itself.
        if (previous?.keyId && previous.workspaceId === workspaceId) {
            await api(fetchFn, `/workspaces/${workspaceId}/api-keys/${previous.keyId}`, session, { method: 'DELETE' }).catch(() => { });
        }

        // A new key reads as invalid for a few seconds.
        let status = 'unknown';
        for (let attempt = 0; attempt < KEY_ACTIVATION_ATTEMPTS; attempt++) {
            status = await checkKey(key, { fetchFn });
            if (status !== 'invalid') break;
            await sleep(KEY_ACTIVATION_DELAY_MILLIS);
        }
        return { key, keyId: id, workspaceId, accountId: signed.accountId, status };
    } finally {
        await closeSession(session, { fetchFn, nowMillis }).catch(() => { });
    }
}

export function loadAccount(storage = globalThis.localStorage) {
    try {
        const account = JSON.parse(storage.getItem(STORAGE_KEY));
        return typeof account?.key === 'string' ? account : null;
    } catch {
        return null;
    }
}

export function storeAccount({ key, keyId = null, workspaceId = null, accountId = null }, storage = globalThis.localStorage) {
    storage.setItem(STORAGE_KEY, JSON.stringify({ key, keyId, workspaceId, accountId }));
}

export function forgetAccount(storage = globalThis.localStorage) {
    storage.removeItem(STORAGE_KEY);
}

/** Not chat models: they cannot run the assistant. */
const NOT_CHAT = /embedding|reranker|whisper|flux|privacy-filter|jev-|sage-/i;

/** NEAR AI's chat models, sorted by name. */
export async function fetchChatModels({ fetchFn = fetch } = {}) {
    const response = await fetchFn(`${NEAR_AI_BASE_URL}/models`);
    if (!response.ok) throw new Error(`NEAR AI did not list its models (HTTP ${response.status})`);
    const { data = [] } = await response.json();
    return data
        .filter((m) => typeof m?.id === 'string' && !NOT_CHAT.test(m.id))
        .filter((m) => (m.architecture?.outputModalities ?? m.output_modalities ?? ['text']).includes('text'))
        .map((m) => ({ id: m.id, name: m.name ?? m.id }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
