import { test } from 'node:test';
import * as assert from 'node:assert';
import { diffLines, diffToMarkdown, describeChange } from '../util/diff';

test('diffLines marks additions and removals', () => {
    const d = diffLines('a\nb\nc', 'a\nB\nc');
    const added = d.filter((l) => l.type === '+').map((l) => l.text);
    const removed = d.filter((l) => l.type === '-').map((l) => l.text);
    assert.deepEqual(removed, ['b']);
    assert.deepEqual(added, ['B']);
});

test('diffLines handles pure append', () => {
    const d = diffLines('a', 'a\nb');
    assert.equal(d.filter((l) => l.type === '+').length, 1);
    assert.equal(d.filter((l) => l.type === '-').length, 0);
});

test('describeChange reports counts', () => {
    const s = describeChange('a\nb\nc', 'a\nc\nd');
    assert.match(s, /1 added/);
    assert.match(s, /1 removed/);
});

test('describeChange handles new files', () => {
    assert.match(describeChange(null, 'x\ny'), /New file \(2 lines\)/);
});

test('diffToMarkdown produces a diff fence', () => {
    const md = diffToMarkdown('a', 'b');
    assert.ok(md.startsWith('```diff'));
    assert.ok(md.includes('-a'));
    assert.ok(md.includes('+b'));
});
