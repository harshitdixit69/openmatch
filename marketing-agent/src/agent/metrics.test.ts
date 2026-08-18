import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAnalytics, extractExternalPostId } from './metrics.js';

test('normalizeAnalytics maps common field aliases', () => {
    const stats = normalizeAnalytics({
        views: 1000,
        link_clicks: 42,
        favorites: 10,
        replies: 3,
        retweets: 5,
        conversions: 2,
    });
    assert.equal(stats.impressions, 1000);
    assert.equal(stats.clicks, 42);
    assert.equal(stats.likes, 10);
    assert.equal(stats.comments, 3);
    assert.equal(stats.shares, 5);
    assert.equal(stats.installs, 2);
});

test('normalizeAnalytics reads from a nested analytics envelope and coerces strings', () => {
    const stats = normalizeAnalytics({ analytics: { impressions: '250', clicks: '7' } });
    assert.equal(stats.impressions, 250);
    assert.equal(stats.clicks, 7);
});

test('normalizeAnalytics defaults missing metrics to 0 and preserves raw', () => {
    const payload = { unrelated: true };
    const stats = normalizeAnalytics(payload);
    assert.equal(stats.impressions, 0);
    assert.equal(stats.clicks, 0);
    assert.deepEqual(stats.raw, payload);
});

test('extractExternalPostId finds ids at top level and inside response', () => {
    assert.equal(extractExternalPostId({ id: 'abc' }), 'abc');
    assert.equal(extractExternalPostId({ response: { post_id: 'xyz' } }), 'xyz');
    assert.equal(extractExternalPostId({ postId: 123 }), '123');
});

test('extractExternalPostId returns null when nothing usable is present', () => {
    assert.equal(extractExternalPostId(null), null);
    assert.equal(extractExternalPostId({ provider: 'none' }), null);
});
