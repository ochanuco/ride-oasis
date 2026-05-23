'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyWay, isOneway } = require('../lib/cycling/tag_classifier');

test('高速道路は自転車不可', () => {
  const r = classifyWay({ highway: 'motorway' });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'highway_blocked');
});

test('国道(primary)は通行可で重みは長め', () => {
  const r = classifyWay({ highway: 'primary' });
  assert.equal(r.allowed, true);
  assert.equal(r.kind, 'primary');
  assert.ok(r.costFactor > 1.0);
});

test('住宅街(residential)は通行可で重みは軽め', () => {
  const r = classifyWay({ highway: 'residential' });
  assert.equal(r.allowed, true);
  assert.ok(r.costFactor <= 1.0);
});

test('cycleway は最も軽い重み', () => {
  const r = classifyWay({ highway: 'cycleway' });
  assert.equal(r.allowed, true);
  assert.ok(r.costFactor < 0.9);
});

test('footway は bicycle=yes でのみ通行可', () => {
  assert.equal(classifyWay({ highway: 'footway' }).allowed, false);
  const r = classifyWay({ highway: 'footway', bicycle: 'yes' });
  assert.equal(r.allowed, true);
  assert.equal(r.kind, 'footway_shared');
});

test('path は designated で軽く、無指定だと重い', () => {
  const designated = classifyWay({ highway: 'path', bicycle: 'designated' });
  const undeclared = classifyWay({ highway: 'path' });
  assert.equal(designated.allowed, true);
  assert.equal(undeclared.allowed, true);
  assert.ok(designated.costFactor < undeclared.costFactor);
});

test('bicycle=no は他のタグに関わらず不可', () => {
  const r = classifyWay({ highway: 'residential', bicycle: 'no' });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'bicycle_denied');
});

test('access=private は bicycle=yes で上書き可能', () => {
  assert.equal(classifyWay({ highway: 'service', access: 'private' }).allowed, false);
  assert.equal(
    classifyWay({ highway: 'service', access: 'private', bicycle: 'yes' }).allowed,
    true
  );
});

test('日本では motorway は bicycle 指定があっても法的に通行不可', () => {
  const r = classifyWay({ highway: 'motorway', bicycle: 'designated' });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'highway_blocked');
});

test('未知の highway 種別は除外', () => {
  const r = classifyWay({ highway: 'rest_area' });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'unknown_highway');
});

test('highway タグ無しは除外', () => {
  assert.equal(classifyWay({ name: '○○通り' }).allowed, false);
  assert.equal(classifyWay({}).allowed, false);
});

test('null/undefined/非オブジェクト入力でも落ちない', () => {
  assert.equal(classifyWay(null).allowed, false);
  assert.equal(classifyWay(undefined).allowed, false);
  assert.equal(classifyWay('highway').allowed, false);
  assert.equal(classifyWay(42).allowed, false);
});

test('タグ値の大文字/前後空白を正規化する', () => {
  const r = classifyWay({ highway: '  Primary  ', bicycle: '  YES ' });
  assert.equal(r.allowed, true);
  assert.equal(r.kind, 'primary');
});

test('oneway=yes は一方通行', () => {
  assert.equal(isOneway({ oneway: 'yes' }), true);
  assert.equal(isOneway({ oneway: 'true' }), true);
  assert.equal(isOneway({ oneway: '1' }), true);
});

test('oneway:bicycle=no は車道一方通行でも自転車は双方向', () => {
  assert.equal(isOneway({ oneway: 'yes', 'oneway:bicycle': 'no' }), false);
});

test('oneway:bicycle=yes は単独で一方通行', () => {
  assert.equal(isOneway({ 'oneway:bicycle': 'yes' }), true);
});

test('oneway 指定なしは双方向扱い', () => {
  assert.equal(isOneway({ highway: 'residential' }), false);
});

test('bridleway は bicycle=yes で通行可、無指定は不可', () => {
  assert.equal(classifyWay({ highway: 'bridleway' }).allowed, false);
  assert.equal(classifyWay({ highway: 'bridleway', bicycle: 'yes' }).allowed, true);
});

test('construction/proposed は除外', () => {
  assert.equal(classifyWay({ highway: 'construction' }).allowed, false);
  assert.equal(classifyWay({ highway: 'proposed' }).allowed, false);
});
