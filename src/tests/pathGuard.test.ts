import { test } from 'node:test';
import * as assert from 'node:assert';
import { resolveInsideWorkspace, isProbablyText, looksBinary } from '../workspace/pathGuard';

test('resolveInsideWorkspace accepts normal relative paths', () => {
    const r = resolveInsideWorkspace('C:/work/app', 'src/index.ts');
    assert.equal(r.ok, true);
    assert.equal(r.relative, 'src/index.ts');
});

test('resolveInsideWorkspace rejects traversal', () => {
    const r = resolveInsideWorkspace('C:/work/app', '../secrets.txt');
    assert.equal(r.ok, false);
    assert.match(r.reason!, /escapes/);
});

test('resolveInsideWorkspace rejects empty path and missing root', () => {
    assert.equal(resolveInsideWorkspace('C:/work/app', '').ok, false);
    assert.equal(resolveInsideWorkspace('', 'a.ts').ok, false);
});

test('resolveInsideWorkspace normalises windows separators', () => {
    const r = resolveInsideWorkspace('C:/work/app', 'src\\lib\\x.ts');
    assert.equal(r.ok, true);
    assert.equal(r.relative, 'src/lib/x.ts');
});

test('isProbablyText recognises source files', () => {
    assert.equal(isProbablyText('.ts'), true);
    assert.equal(isProbablyText('.png'), false);
    assert.equal(isProbablyText(''), true);
});

test('looksBinary detects null bytes', () => {
    assert.equal(looksBinary(Buffer.from([1, 2, 0, 4])), true);
    assert.equal(looksBinary(Buffer.from('hello world', 'utf8')), false);
});
