#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../tools/pluginctl-lib');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('normalizes GitHub repository URLs', () => {
  assert.deepStrictEqual(lib.normalizeGithubRepository('DietrichGebert/ponytail'), {
    repository: 'DietrichGebert/ponytail',
    cloneUrl: 'https://github.com/DietrichGebert/ponytail.git'
  });
  assert.strictEqual(lib.normalizeGithubRepository('https://github.com/DietrichGebert/ponytail.git').repository, 'DietrichGebert/ponytail');
});

test('selects an exact branch ref', () => {
  const result = lib.selectLsRemoteRef('abc\trefs/heads/main\ndef\trefs/heads/dev\n', { type: 'branch', value: 'main' });
  assert.strictEqual(result, 'abc');
});

test('directory hashes are stable across creation order', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pluginctl-test-'));
  try {
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    fs.mkdirSync(a); fs.mkdirSync(b);
    fs.writeFileSync(path.join(a, 'z.txt'), 'z'); fs.writeFileSync(path.join(a, 'a.txt'), 'a');
    fs.writeFileSync(path.join(b, 'a.txt'), 'a'); fs.writeFileSync(path.join(b, 'z.txt'), 'z');
    assert.strictEqual(lib.hashDirectory(a), lib.hashDirectory(b));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validates matching Claude and Codex manifests', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pluginctl-plugin-'));
  try {
    for (const platform of ['claude', 'codex']) {
      const dir = path.join(root, `.${platform}-plugin`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: 'demo', version: '1.2.3', description: 'Demo plugin' }));
    }
    const result = lib.validatePlugin(root, 'demo', ['claude', 'codex']);
    assert.deepStrictEqual(result.errors, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('parses Git porcelain output including renames', () => {
  assert.deepStrictEqual(lib.parseGitStatusPorcelain(' M README.md\n?? new.txt\n'), ['README.md', 'new.txt']);
});

let failures = 0;
for (const item of tests) {
  try {
    item.fn();
    console.log(`ok - ${item.name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${item.name}`);
    console.error(error.stack || error.message);
  }
}
if (failures) process.exitCode = 1;
else console.log(`\n${tests.length} tests passed`);
