import { test } from 'node:test';
import * as assert from 'node:assert';
import { MemoryStore } from '../memory/memory';

function fakeCtx() {
    const store = new Map<string, unknown>();
    return {
        globalState: {
            get: (k: string, d?: unknown) => (store.has(k) ? store.get(k) : d),
            update: async (k: string, v: unknown) => { store.set(k, v); }
        }
    } as any;
}

test('memory: add and list', () => {
    const m = new MemoryStore(fakeCtx(), () => '');
    const e = m.add('User prefers TypeScript and Tailwind', ['prefs']);
    assert.ok(e.id);
    assert.equal(m.all().length, 1);
    assert.equal(m.all()[0].text, 'User prefers TypeScript and Tailwind');
    assert.deepEqual(m.all()[0].tags, ['prefs']);
});

test('memory: identical text is de-duplicated', () => {
    const m = new MemoryStore(fakeCtx(), () => '');
    m.add('Use pnpm');
    m.add('use pnpm');
    assert.equal(m.all().length, 1);
});

test('memory: empty text is rejected', () => {
    const m = new MemoryStore(fakeCtx(), () => '');
    assert.throws(() => m.add('   '));
});

test('memory: search ranks keyword matches first', () => {
    const m = new MemoryStore(fakeCtx(), () => '');
    m.add('Project uses Next.js 14 with app router');
    m.add('User likes dark themes');
    const hits = m.search('next.js router');
    assert.ok(hits.length >= 1);
    assert.match(hits[0].text, /Next\.js/);
});

test('memory: search with empty query returns newest', () => {
    const m = new MemoryStore(fakeCtx(), () => '');
    m.add('first');
    m.add('second');
    const hits = m.search('');
    assert.equal(hits[0].text, 'second');
});

test('memory: remove and clear', () => {
    const m = new MemoryStore(fakeCtx(), () => '');
    const a = m.add('alpha');
    m.add('beta');
    assert.equal(m.remove(a.id), true);
    assert.equal(m.remove('nope'), false);
    assert.equal(m.all().length, 1);
    m.clear();
    assert.equal(m.all().length, 0);
});

test('memory: relevantBlock is empty when nothing matches', () => {
    const m = new MemoryStore(fakeCtx(), () => '');
    assert.equal(m.relevantBlock('completely unrelated zzz'), '');
});

test('memory: relevantBlock includes matching facts', () => {
    const m = new MemoryStore(fakeCtx(), () => '');
    m.add('Deploys happen on the vclub.tech VPS');
    const block = m.relevantBlock('deploy the site to vclub');
    assert.match(block, /vclub\.tech/);
});
