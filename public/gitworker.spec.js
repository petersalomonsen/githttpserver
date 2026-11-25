describe('git worker', function () {
    this.timeout(30000);

    function call(worker, command, params = {}) {
        const id = Math.random();
        return new Promise((resolve, reject) => {
            worker.addEventListener('message', function listener(msg) {
                if (msg.data.id !== id) return;
                worker.removeEventListener('message', listener);
                if (msg.data.error) reject(new Error(msg.data.error));
                else resolve(msg.data.result);
            });
            worker.postMessage({ id, command, ...params });
        });
    }

    it('should configure the user', async () => {
        const worker = new Worker(new URL('gitworker.js', import.meta.url), { type: 'module' });
        assert.isTrue(await call(worker, 'configureuser', { token: 'token', name: 'abc', email: 'def@example.com' }));
        worker.terminate();
    });

    it('should report a repository that is not cloned', async () => {
        const worker = new Worker(new URL('gitworker.js', import.meta.url), { type: 'module' });
        const result = await call(worker, 'open', { url: 'http://localhost/not-cloned-' + Date.now() });
        assert.isFalse(result.cloned);
        try {
            await call(worker, 'tree');
            assert.fail('tree should fail without a clone');
        } catch (e) {
            assert.include(e.message, 'no local clone');
        }
        worker.terminate();
    });
});
