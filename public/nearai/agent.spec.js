import {
    applyEdit, numberLines, pruneSupersededReads, runAgentTurn, forHistory, SUPERSEDED_NOTE,
} from './agent.js';

describe('assistant agent', () => {
    describe('applyEdit', () => {
        it('replaces a unique piece of text', () => {
            assert.equal(applyEdit('a\nb\nc\n', { old_text: 'b\n', new_text: 'B\n' }), 'a\nB\nc\n');
        });
        it('treats $ in the replacement literally', () => {
            assert.equal(applyEdit('x = 1', { old_text: '1', new_text: '$&$1' }), 'x = $&$1');
        });
        it('refuses text that is missing', () => {
            assert.throws(() => applyEdit('abc', { old_text: 'zzz', new_text: '' }), /not found/);
        });
        it('refuses ambiguous text unless replace_all', () => {
            assert.throws(() => applyEdit('aa', { old_text: 'a', new_text: 'b' }), /occurs 2 times/);
            assert.equal(applyEdit('aa', { old_text: 'a', new_text: 'b', replace_all: true }), 'bb');
        });
    });

    describe('numberLines', () => {
        it('numbers a range of lines', () => {
            assert.equal(numberLines('a\nb\nc', 2, 3), '2| b\n3| c\n');
        });
        it('says where to read on when cut', () => {
            const text = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
            const out = numberLines(text, 1, Infinity, 50);
            assert.match(out, /read on with start_line=\d+/);
        });
    });

    it('supersedes an older read of a file that was read or changed later', () => {
        const call = (id, name, path) => ({ id, type: 'function', function: { name, arguments: JSON.stringify({ path }) } });
        const messages = [
            { role: 'assistant', content: '', tool_calls: [call('1', 'read_file', 'a.js'), call('2', 'read_file', 'b.js')] },
            { role: 'tool', tool_call_id: '1', content: 'old a' },
            { role: 'tool', tool_call_id: '2', content: 'b' },
            { role: 'assistant', content: '', tool_calls: [call('3', 'edit_file', 'a.js')] },
            { role: 'tool', tool_call_id: '3', content: 'edited a.js' },
        ];
        const pruned = pruneSupersededReads(messages);
        assert.equal(pruned[1].content, SUPERSEDED_NOTE);
        assert.equal(pruned[2].content, 'b');
        assert.equal(pruned[4].content, 'edited a.js');
    });

    it('normalises tool arguments that are not JSON', () => {
        const msg = forHistory({ role: 'assistant', content: null, reasoning_content: 'secret', tool_calls: [{ id: 'x', function: { name: 'git_status', arguments: '' } }] });
        assert.equal(msg.tool_calls[0].function.arguments, '{}');
        assert.notProperty(msg, 'reasoning_content');
    });

    it('runs tool calls until the model answers', async () => {
        const replies = [
            { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'git_status', arguments: '{}' } }] } }] },
            { choices: [{ message: { role: 'assistant', content: 'All clean.' }, finish_reason: 'stop' }] },
        ];
        const requests = [];
        const fetchFn = async (url, init) => {
            requests.push(JSON.parse(init.body));
            return new Response(JSON.stringify(replies.shift()), { status: 200 });
        };
        const calls = [];
        const messages = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'status?' }];
        const result = await runAgentTurn({
            fetchFn, baseUrl: 'https://example.invalid/v1', apiKey: 'k', model: 'm', messages,
            runTool: async (name, args) => { calls.push(name); return 'no uncommitted changes'; },
        });
        assert.deepEqual(calls, ['git_status']);
        assert.isTrue(result.answered);
        assert.equal(messages.at(-1).content, 'All clean.');
        assert.equal(requests[1].messages.at(-1).role, 'tool');
        assert.equal(requests[1].messages.at(-1).content, 'no uncommitted changes');
    });

    it('retries rate limits and reports a missing-credits error', async () => {
        let n = 0;
        const fetchFn = async () => (++n === 1
            ? new Response('busy', { status: 429 })
            : new Response(JSON.stringify({ error: { message: 'no credits' } }), { status: 402 }));
        try {
            await runAgentTurn({
                fetchFn, baseUrl: 'x', apiKey: 'k', model: 'm', messages: [], runTool: async () => '',
                sleepFn: async () => { },
            });
            assert.fail('should throw');
        } catch (e) {
            assert.isTrue(e.outOfCredits);
            assert.equal(n, 2);
        }
    });
});
