// src/lib/searchHistory.ts
//
// Recent search terms, stored per-user on the device.
//
// The Settings row "Clear search history" previously reported success without
// clearing anything, because nothing was ever stored: SearchScreen kept its
// query in useState only. This module gives that row something real to clear,
// and gives the search box a recents list.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const MAX_SEARCH_HISTORY = 8;

export function searchHistoryKey(userId: string) {
    return `openmatch:searchHistory:${userId}`;
}

function normalize(term: string) {
    return term.trim().replace(/\s+/g, ' ');
}

/**
 * Returns the history with `term` promoted to the front, de-duplicated
 * case-insensitively and capped. Pure so the ordering rules are testable
 * without touching storage.
 */
export function addSearchTerm(history: string[], term: string): string[] {
    const cleaned = normalize(term);
    if (!cleaned) return history;

    const rest = history.filter((entry) => entry.toLowerCase() !== cleaned.toLowerCase());
    return [cleaned, ...rest].slice(0, MAX_SEARCH_HISTORY);
}

function sanitize(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((entry): entry is string => typeof entry === 'string')
        .map(normalize)
        .filter(Boolean)
        .slice(0, MAX_SEARCH_HISTORY);
}

export async function loadSearchHistory(userId: string): Promise<string[]> {
    try {
        const raw = await AsyncStorage.getItem(searchHistoryKey(userId));
        return raw ? sanitize(JSON.parse(raw)) : [];
    } catch (error) {
        console.warn('Failed to load search history:', error);
        return [];
    }
}

export async function recordSearchTerm(userId: string, term: string): Promise<string[]> {
    const current = await loadSearchHistory(userId);
    const next = addSearchTerm(current, term);

    // Nothing changed (empty or already first) — skip the write.
    if (next.length === current.length && next[0] === current[0]) {
        return current;
    }

    try {
        await AsyncStorage.setItem(searchHistoryKey(userId), JSON.stringify(next));
    } catch (error) {
        console.warn('Failed to save search history:', error);
    }
    return next;
}

export async function clearSearchHistory(userId: string): Promise<void> {
    await AsyncStorage.removeItem(searchHistoryKey(userId));
}
