import { test } from 'node:test';
import * as assert from 'node:assert';
import { globToRegExp, GlobSet, GitIgnore, relevanceScore } from '../context/ignore';

test('glob matches nested files with **', () => {
    const re = globToRegExp('**/node_modules/**');
    assert.equal(re.test('node_modules/x/y.js'), true);
    assert.equal(re.test('src/node_modules/x.js'), true);
    assert.equal(re.test('src/app.ts'), false);
});

test('glob handles single star within a segment', () => {
    const re = globToRegExp('src/*.ts');
    assert.equal(re.test('src/a.ts'), true);
    assert.equal(re.test('src/sub/a.ts'), false);
});

test('glob handles question mark and braces', () => {
    assert.equal(globToRegExp('a?.js').test('ab.js'), true);
    assert.equal(globToRegExp('*.{ts,tsx}').test('x.tsx'), true);
    assert.equal(globToRegExp('*.{ts,tsx}').test('x.js'), false);
});

test('GlobSet matches any pattern', () => {
    const set = new GlobSet(['**/dist/**', '**/*.map']);
    assert.equal(set.matches('dist/a.js'), true);
    assert.equal(set.matches('src/a.map'), true);
    assert.equal(set.matches('src/a.ts'), false);
});

test('GitIgnore ignores build output and respects negation', () => {
    const gi = new GitIgnore('node_modules/\ndist/\n!dist/keep.js\n*.log\n');
    assert.equal(gi.ignores('node_modules/a.js'), true);
    assert.equal(gi.ignores('dist/bundle.js'), true);
    assert.equal(gi.ignores('dist/keep.js'), false);
    assert.equal(gi.ignores('debug.log'), true);
    assert.equal(gi.ignores('src/app.ts'), false);
});

test('relevanceScore ranks matching files higher', () => {
    const task = 'add login page with auth';
    const auth = relevanceScore('src/auth/login.tsx', task);
    const unrelated = relevanceScore('src/utils/format.ts', task);
    assert.ok(auth > unrelated, `expected ${auth} > ${unrelated}`);
});

test('relevanceScore boosts package.json', () => {
    assert.ok(relevanceScore('package.json', 'anything') >= 3);
});
