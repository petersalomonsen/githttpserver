describe('libgit2 webworker', function () {
    this.timeout(10000);
    it('should receive confirmation that access token was configured in webworker', async () => {
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