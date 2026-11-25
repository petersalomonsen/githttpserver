// Unified diffs of working-tree files against HEAD, computed in the page with
// jsdiff (lg2's diff cannot be limited to one path).

const jsdiff = import('https://esm.sh/diff@8');

/**
 * @param {(command: string, params: object) => Promise<any>} git the worker call
 * @returns {Promise<string>} a unified diff, or '' when the file is unchanged
 */
export async function fileDiff(git, path) {
    const [{ createTwoFilesPatch }, before, after] = await Promise.all([
        jsdiff,
        git('readhead', { path }),
        git('readfile', { path }).catch(() => null),
    ]);
    if (before === after) return '';
    return createTwoFilesPatch(
        before === null ? '/dev/null' : `a/${path}`,
        after === null ? '/dev/null' : `b/${path}`,
        before ?? '', after ?? '', '', '', { context: 3 },
    ).split('\n').filter(line => !line.startsWith('Index: ') && !/^=+$/.test(line)).join('\n');
}

/** Count of added and removed lines in a unified diff. */
export function diffStat(patch) {
    let added = 0;
    let removed = 0;
    for (const line of patch.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++')) added++;
        else if (line.startsWith('-') && !line.startsWith('---')) removed++;
    }
    return { added, removed };
}

/** A <pre> with the diff's lines coloured. */
export function renderDiff(patch) {
    const pre = document.createElement('pre');
    pre.className = 'diff';
    for (const line of patch.split('\n')) {
        const span = document.createElement('span');
        span.textContent = line + '\n';
        if (line.startsWith('+++') || line.startsWith('---')) span.className = 'meta';
        else if (line.startsWith('@@')) span.className = 'hunk';
        else if (line.startsWith('+')) span.className = 'add';
        else if (line.startsWith('-')) span.className = 'del';
        pre.append(span);
    }
    return pre;
}
