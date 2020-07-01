describe('libgit2 webworker', function() {
    it.only('should be able to send token to the worker without waiting for ready message', async () => {
        const worker = new Worker('libgit2_webworker.js');
        worker.postMessage({
            accessToken: 'token',
            username: 'abc',
            useremail: 'def@example.com'
        });
        const msg = await new Promise(resolve =>
            worker.onmessage = (msg) => resolve(msg)
        );
        assert.isTrue(msg.data.accessTokenConfigured);
    });
});