import { exec } from 'child_process';
export const MAX_REPOSITORY_SIZE = 10 * 1024 * 1024; // Max repository size 10 MB

export async function checkIfQuotaIsExceeded(repodir) {
    const currentSize = (await new Promise(resolve => exec(`du -sh ${repodir}`, (err, stdout) => resolve(stdout)))).split(/\t/)[0];
    const sizeUnit = currentSize.substring(currentSize.length - 1);
    const sizeUnits = {'B': 1, 'K': 1024, 'M': 1024 * 1024, 'G': 1024 * 1024 * 1024};
    const currentSizeBytes = parseFloat(currentSize) * sizeUnits[sizeUnit];
    const quotaexceeded = currentSizeBytes > MAX_REPOSITORY_SIZE;
    if (quotaexceeded) {
        console.log(`quota exceeded for ${repodir} ( ${currentSizeBytes} > ${MAX_REPOSITORY_SIZE})`);
    }
    return quotaexceeded;
}