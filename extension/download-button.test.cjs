'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const flow = require('./download-button.js');
const contract = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'shared', 'download-button.contract.json'), 'utf8'));

test('browser implementation mirrors the shared contract', () => {
  assert.deepEqual(flow.CONTRACT.states, contract.states);
  assert.deepEqual(flow.CONTRACT.labels, contract.labels);
  assert.deepEqual(flow.CONTRACT.aria, contract.aria);
  assert.deepEqual(flow.CONTRACT.colors, contract.colors);
  assert.equal(flow.CONTRACT.timing.sweepMs, contract.timing.sweepMs);
});

test('every state has a label, an aria template and a gradient', () => {
  for (const state of contract.states) {
    assert.equal(typeof contract.labels[state], 'string', `label for ${state}`);
    assert.equal(typeof contract.aria[state], 'string', `aria for ${state}`);
    assert.equal(contract.colors[state].length, 2, `gradient for ${state}`);
  }
});

test('percent formatting keeps one decimal and never exceeds 100%', () => {
  assert.equal(flow.formatPercent(0), '0.0%');
  assert.equal(flow.formatPercent(7.84), '7.8%');
  assert.equal(flow.formatPercent(92.36), '92.4%');
  assert.equal(flow.formatPercent(99.95), '100%');
  assert.equal(flow.formatPercent(140), '100%');
  assert.equal(flow.formatPercent(-3), '0.0%');
  assert.equal(flow.formatPercent('nonsense'), '0.0%');
});

test('progress is clamped into the 0-100 range', () => {
  assert.equal(flow.clampProgress(-1), 0);
  assert.equal(flow.clampProgress(50), 50);
  assert.equal(flow.clampProgress(1000), 100);
});

test('download flow advances and refuses impossible rewinds', () => {
  assert.ok(flow.canTransition('idle', 'preparing'));
  assert.ok(flow.canTransition('preparing', 'queued'));
  assert.ok(flow.canTransition('queued', 'downloading'));
  assert.ok(flow.canTransition('downloading', 'complete'));
  assert.ok(flow.canTransition('downloading', 'error'));
  assert.ok(flow.canTransition('error', 'preparing'));
  assert.ok(flow.canTransition('complete', 'idle'));

  assert.equal(flow.canTransition('complete', 'downloading'), false);
  assert.equal(flow.canTransition('idle', 'complete'), false);
  assert.equal(flow.canTransition('error', 'complete'), false);
  assert.equal(flow.canTransition('nope', 'idle'), false);
});

test('aria text carries the rounded percentage', () => {
  assert.equal(flow.ariaFor('downloading', 42.6), 'Downloading, 43 percent');
  assert.equal(flow.ariaFor('downloading', 100), 'Downloading, 100 percent');
  assert.equal(flow.ariaFor('idle', 0), contract.aria.idle);
  assert.equal(flow.ariaFor('error', 0), contract.aria.error);
});

test('styles cover hover, active, focus, compact and reduced motion', () => {
  for (const marker of [':hover', ':active', ':focus-visible', 'data-compact="true"', 'prefers-reduced-motion']) {
    assert.ok(flow.CSS.includes(marker), `css handles ${marker}`);
  }
});

test('attach rejects non-elements instead of failing silently', () => {
  assert.throws(() => flow.attach(null), /needs a <button> element/);
});
