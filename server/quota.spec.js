import { writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, rmdirSync } from 'fs';
import { MAX_REPOSITORY_SIZE, checkIfQuotaIsExceeded } from './quota.js';
import { expect } from 'chai';
import { tmpdir } from 'os';

const testdir = `${tmpdir}/testdir`;

describe('checkquota', function () {
    this.timeout(20000);
    it('should check if quota is exceeded', async () => {
        mkdirSync(testdir);
        
        const filesize = MAX_REPOSITORY_SIZE / 2;
        
        writeFileSync(`${testdir}/test.bin`, new Uint8Array(filesize));
        expect(await checkIfQuotaIsExceeded(testdir)).to.be.false;
        writeFileSync(`${testdir}/test2.bin`, new Uint8Array(filesize/2));
        expect(await checkIfQuotaIsExceeded(testdir)).to.be.false;
        writeFileSync(`${testdir}/test3.bin`, new Uint8Array(filesize));
        expect(await checkIfQuotaIsExceeded(testdir)).to.be.true;
        
    });
    afterEach(() => {
        if(existsSync(testdir)) {
            readdirSync(testdir).forEach(f => rmSync(`${testdir}/${f}`));
            rmdirSync(testdir);
        }        
    });
});