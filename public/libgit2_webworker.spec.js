describe('libgit2 webworker', function () {
    it.only('should be able to send token to the worker without waiting for ready message', async () => {
        const worker = new Worker('libgit2_webworker.js');
        const replyPromise = new Promise(resolve =>
            worker.onmessage = (msg) => resolve(msg)
        );
        worker.postMessage({
            accessToken: 'token',
            username: 'abc',
            useremail: 'def@example.com'
        });
        const msg = await replyPromise;
        assert.isTrue(msg.data.accessTokenConfigured);
    });
});