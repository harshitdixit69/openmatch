import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runSafetyCheck, safetyTermsForTopic } from './safety.js';

const BANNED = [
    'caste-based discrimination',
    'religious superiority',
    'dowry',
    'skin-tone / colourism',
    'guaranteed marriage / results',
    'disparaging named competitors',
];

test('clean copy produces no flags', () => {
    const flags = runSafetyCheck(
        'Find someone who truly gets you. Free to match and chat on OpenMatch.',
        BANNED,
    );
    assert.deepEqual(flags, []);
});

test('flags dowry mentions', () => {
    const flags = runSafetyCheck('No dowry, no drama — just honest matchmaking.', BANNED);
    assert.ok(flags.includes('dowry'));
});

test('flags colourism via synonym (fair skin), not just first word', () => {
    const flags = runSafetyCheck('Meet fair skin brides today.', BANNED);
    assert.ok(flags.includes('skin-tone / colourism'));
});

test('flags guaranteed-results claims', () => {
    const flags = runSafetyCheck('Marriage guaranteed within 3 months!', BANNED);
    assert.ok(flags.includes('guaranteed marriage / results'));
});

test('flags disparaging a named competitor', () => {
    const flags = runSafetyCheck('We are way better than Shaadi.', BANNED);
    assert.ok(flags.includes('disparaging named competitors'));
});

test('does not false-positive on substrings inside other words', () => {
    // "castle" contains "cast" but must not trigger the caste rule.
    const flags = runSafetyCheck('A castle wedding venue for your big day.', BANNED);
    assert.ok(!flags.includes('caste-based discrimination'));
});

test('safetyTermsForTopic falls back to significant words for unknown topics', () => {
    const terms = safetyTermsForTopic('some brand new banned topic');
    assert.ok(terms.includes('some'));
    assert.ok(terms.includes('brand'));
    assert.ok(!terms.includes('new')); // 3 chars, filtered out
});
