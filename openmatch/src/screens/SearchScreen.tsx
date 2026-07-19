// src/screens/SearchScreen.tsx
// F4 – Search / Discovery
// Text search (client-side name/location/bio match) layered on top of
// fetchFilteredMatches() which drives match_profiles() with DB-level filters.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../components/BackButton';
import { BookmarkButton } from '../components/BookmarkButton';
import { ChipPicker } from '../components/prefs/ChipPicker';
import { type MatchCandidate } from '../lib/matchmaking';
import {
    PREF_DIETS,
    PREF_EDUCATIONS,
    PREF_RELIGIONS,
    type PartnerPreferences,
    type PrefDiet,
    type PrefEducation,
    type PrefReligion,
} from '../lib/partnerPreferences';
import { fetchFilteredMatches } from '../lib/partnerPreferencesApi';
import { fetchShortlistedIds } from '../lib/shortlistApi';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActiveFilters = {
    religion: PrefReligion | null;
    education: PrefEducation | null;
    diet: PrefDiet | null;
    age_min: number | null;
    age_max: number | null;
};

const EMPTY_FILTERS: ActiveFilters = {
    religion: null,
    education: null,
    diet: null,
    age_min: null,
    age_max: null,
};

// Quick age-bracket chips
const AGE_BRACKETS: { label: string; min: number; max: number }[] = [
    { label: '18–25', min: 18, max: 25 },
    { label: '26–30', min: 26, max: 30 },
    { label: '31–35', min: 31, max: 35 },
    { label: '36–40', min: 36, max: 40 },
    { label: '41+', min: 41, max: 99 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calcAge(dob: string): number {
    const birth = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    if (
        today.getMonth() < birth.getMonth() ||
        (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
    ) age--;
    return age;
}

function matchesQuery(c: MatchCandidate, q: string): boolean {
    if (!q) return true;
    const lower = q.toLowerCase();
    return (
        c.full_name.toLowerCase().includes(lower) ||
        c.location.toLowerCase().includes(lower) ||
        (c.bio ?? '').toLowerCase().includes(lower) ||
        (c.preferences ?? '').toLowerCase().includes(lower)
    );
}

function filtersToPrefs(f: ActiveFilters): Partial<PartnerPreferences> {
    return {
        pref_religion: f.religion,
        pref_education: f.education,
        pref_diet: f.diet,
        pref_age_min: f.age_min,
        pref_age_max: f.age_max,
    };
}

function countActiveFilters(f: ActiveFilters): number {
    return [f.religion, f.education, f.diet, f.age_min].filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SearchResultCard({
    candidate,
    saved,
    onPress,
    onBookmarkToggled,
}: {
    candidate: MatchCandidate;
    saved: boolean;
    onPress: (c: MatchCandidate) => void;
    onBookmarkToggled: (id: string, saved: boolean) => void;
}) {
    const age = calcAge(candidate.dob);
    const photo = candidate.photo_urls?.[0];

    const isPremium = candidate.subscription_tier && candidate.subscription_tier !== 'free';

    return (
        <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed, isPremium ? styles.cardPremium : null]}
            onPress={() => onPress(candidate)}
        >
            <View style={styles.cardPhoto}>
                {photo ? (
                    <Image source={{ uri: photo }} style={styles.cardImg} />
                ) : (
                    <View style={styles.cardImgPlaceholder}>
                        <Text style={styles.cardImgPlaceholderText}>
                            {candidate.full_name.charAt(0).toUpperCase()}
                        </Text>
                    </View>
                )}
            </View>
            <View style={styles.cardBody}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={[styles.cardName, { flexShrink: 1 }]} numberOfLines={1}>{candidate.full_name}</Text>
                    {isPremium ? (
                        <Text style={{ fontSize: 14, marginLeft: 4, color: '#c8a261', alignSelf: 'center' }}>👑</Text>
                    ) : null}
                </View>
                <Text style={styles.cardMeta} numberOfLines={1}>
                    {age} · {candidate.location}
                </Text>
                {candidate.bio ? (
                    <Text style={styles.cardBio} numberOfLines={2}>{candidate.bio}</Text>
                ) : null}
            </View>
            <View style={styles.cardRight}>
                {candidate.similarity > 0 && (
                    <View style={styles.cardBadge}>
                        <Text style={styles.cardBadgeText}>
                            {Math.round(candidate.similarity * 100)}%
                        </Text>
                    </View>
                )}
                <BookmarkButton
                    profileId={candidate.id}
                    saved={saved}
                    size="small"
                    onToggled={(s) => onBookmarkToggled(candidate.id, s)}
                />
            </View>
        </Pressable>
    );
}

function FilterBar({
    filters,
    onChange,
    onClear,
}: {
    filters: ActiveFilters;
    onChange: (f: ActiveFilters) => void;
    onClear: () => void;
}) {
    const [activeDropdown, setActiveDropdown] = useState<'age' | 'religion' | 'education' | 'diet' | null>(null);
    const activeCount = countActiveFilters(filters);

    let currentAgeLabel = 'Age';
    if (filters.age_min !== null && filters.age_max !== null) {
        const bracket = AGE_BRACKETS.find(b => b.min === filters.age_min && b.max === filters.age_max);
        if (bracket) currentAgeLabel = bracket.label;
    }

    const currentReligionLabel = filters.religion || 'Religion';
    const currentEducationLabel = filters.education || 'Education';
    const currentDietLabel = filters.diet || 'Diet';

    const toggleDropdown = (type: 'age' | 'religion' | 'education' | 'diet') => {
        setActiveDropdown(prev => prev === type ? null : type);
    };

    return (
        <View style={styles.filterContainer}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ overflow: 'visible' }}
                contentContainerStyle={styles.filterBar}
            >
                {/* Age Dropdown */}
                <View style={{ position: 'relative', zIndex: activeDropdown === 'age' ? 100 : 1 }}>
                    <Pressable
                        style={[styles.filterDropdownButton, (filters.age_min !== null) && styles.filterChipActive]}
                        onPress={() => toggleDropdown('age')}
                    >
                        <Text style={[styles.filterChipText, (filters.age_min !== null) && styles.filterChipTextActive]}>
                            {currentAgeLabel} {activeDropdown === 'age' ? '▴' : '▾'}
                        </Text>
                    </Pressable>
                    {activeDropdown === 'age' && (
                        <View style={styles.dropdownMenu}>
                            <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                                <Pressable
                                    style={styles.dropdownOption}
                                    onPress={() => {
                                        onChange({ ...filters, age_min: null, age_max: null });
                                        setActiveDropdown(null);
                                    }}
                                >
                                    <Text style={[styles.dropdownOptionText, (filters.age_min === null) && styles.dropdownOptionTextActive]}>Any</Text>
                                </Pressable>
                                {AGE_BRACKETS.map((b) => {
                                    const isActive = filters.age_min === b.min && filters.age_max === b.max;
                                    return (
                                        <Pressable
                                            key={b.label}
                                            style={styles.dropdownOption}
                                            onPress={() => {
                                                onChange({ ...filters, age_min: b.min, age_max: b.max });
                                                setActiveDropdown(null);
                                            }}
                                        >
                                            <Text style={[styles.dropdownOptionText, isActive && styles.dropdownOptionTextActive]}>{b.label}</Text>
                                        </Pressable>
                                    );
                                })}
                            </ScrollView>
                        </View>
                    )}
                </View>

                {/* Religion Dropdown */}
                <View style={{ position: 'relative', zIndex: activeDropdown === 'religion' ? 100 : 1 }}>
                    <Pressable
                        style={[styles.filterDropdownButton, filters.religion && styles.filterChipActive]}
                        onPress={() => toggleDropdown('religion')}
                    >
                        <Text style={[styles.filterChipText, filters.religion && styles.filterChipTextActive]}>
                            {currentReligionLabel} {activeDropdown === 'religion' ? '▴' : '▾'}
                        </Text>
                    </Pressable>
                    {activeDropdown === 'religion' && (
                        <View style={styles.dropdownMenu}>
                            <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                                <Pressable
                                    style={styles.dropdownOption}
                                    onPress={() => {
                                        onChange({ ...filters, religion: null });
                                        setActiveDropdown(null);
                                    }}
                                >
                                    <Text style={[styles.dropdownOptionText, !filters.religion && styles.dropdownOptionTextActive]}>Any</Text>
                                </Pressable>
                                {PREF_RELIGIONS.filter((r) => r !== 'Any').map((r) => {
                                    const isActive = filters.religion === r;
                                    return (
                                        <Pressable
                                            key={r}
                                            style={styles.dropdownOption}
                                            onPress={() => {
                                                onChange({ ...filters, religion: r });
                                                setActiveDropdown(null);
                                            }}
                                        >
                                            <Text style={[styles.dropdownOptionText, isActive && styles.dropdownOptionTextActive]}>{r}</Text>
                                        </Pressable>
                                    );
                                })}
                            </ScrollView>
                        </View>
                    )}
                </View>

                {/* Education Dropdown */}
                <View style={{ position: 'relative', zIndex: activeDropdown === 'education' ? 100 : 1 }}>
                    <Pressable
                        style={[styles.filterDropdownButton, filters.education && styles.filterChipActive]}
                        onPress={() => toggleDropdown('education')}
                    >
                        <Text style={[styles.filterChipText, filters.education && styles.filterChipTextActive]}>
                            {currentEducationLabel} {activeDropdown === 'education' ? '▴' : '▾'}
                        </Text>
                    </Pressable>
                    {activeDropdown === 'education' && (
                        <View style={styles.dropdownMenu}>
                            <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                                <Pressable
                                    style={styles.dropdownOption}
                                    onPress={() => {
                                        onChange({ ...filters, education: null });
                                        setActiveDropdown(null);
                                    }}
                                >
                                    <Text style={[styles.dropdownOptionText, !filters.education && styles.dropdownOptionTextActive]}>Any</Text>
                                </Pressable>
                                {PREF_EDUCATIONS.filter((e) => e !== 'Any').map((e) => {
                                    const isActive = filters.education === e;
                                    return (
                                        <Pressable
                                            key={e}
                                            style={styles.dropdownOption}
                                            onPress={() => {
                                                onChange({ ...filters, education: e });
                                                setActiveDropdown(null);
                                            }}
                                        >
                                            <Text style={[styles.dropdownOptionText, isActive && styles.dropdownOptionTextActive]}>{e}</Text>
                                        </Pressable>
                                    );
                                })}
                            </ScrollView>
                        </View>
                    )}
                </View>

                {/* Diet Dropdown */}
                <View style={{ position: 'relative', zIndex: activeDropdown === 'diet' ? 100 : 1 }}>
                    <Pressable
                        style={[styles.filterDropdownButton, filters.diet && styles.filterChipActive]}
                        onPress={() => toggleDropdown('diet')}
                    >
                        <Text style={[styles.filterChipText, filters.diet && styles.filterChipTextActive]}>
                            {currentDietLabel} {activeDropdown === 'diet' ? '▴' : '▾'}
                        </Text>
                    </Pressable>
                    {activeDropdown === 'diet' && (
                        <View style={styles.dropdownMenu}>
                            <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                                <Pressable
                                    style={styles.dropdownOption}
                                    onPress={() => {
                                        onChange({ ...filters, diet: null });
                                        setActiveDropdown(null);
                                    }}
                                >
                                    <Text style={[styles.dropdownOptionText, !filters.diet && styles.dropdownOptionTextActive]}>Any</Text>
                                </Pressable>
                                {PREF_DIETS.filter((d) => d !== 'Any').map((d) => {
                                    const isActive = filters.diet === d;
                                    return (
                                        <Pressable
                                            key={d}
                                            style={styles.dropdownOption}
                                            onPress={() => {
                                                onChange({ ...filters, diet: d });
                                                setActiveDropdown(null);
                                            }}
                                        >
                                            <Text style={[styles.dropdownOptionText, isActive && styles.dropdownOptionTextActive]}>{d}</Text>
                                        </Pressable>
                                    );
                                })}
                            </ScrollView>
                        </View>
                    )}
                </View>

                {/* Clear Button */}
                {activeCount > 0 && (
                    <Pressable style={styles.clearChip} onPress={onClear}>
                        <Text style={styles.clearChipText}>✕ Clear</Text>
                    </Pressable>
                )}
            </ScrollView>
        </View>
    );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

interface Props {
    onBack: () => void;
    onSelectCandidate: (c: MatchCandidate) => void;
}

export function SearchScreen({ onBack, onSelectCandidate }: Props) {
    const insets = useSafeAreaInsets();
    const [query, setQuery] = useState('');
    const [filters, setFilters] = useState<ActiveFilters>(EMPTY_FILTERS);
    const [allResults, setAllResults] = useState<MatchCandidate[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const latestFetchId = useRef(0);

    // Fetch when filters change (debounced)
    const triggerFetch = useCallback((f: ActiveFilters) => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(async () => {
            const fetchId = ++latestFetchId.current;
            setLoading(true);
            setError(null);
            try {
                const prefs = filtersToPrefs(f);
                const data = await fetchFilteredMatches({ ...prefs, result_limit: 60 });
                if (fetchId !== latestFetchId.current) return; // stale
                setAllResults((data ?? []) as MatchCandidate[]);
            } catch (e: any) {
                if (fetchId !== latestFetchId.current) return;
                setError(e?.message ?? 'Search failed.');
            } finally {
                if (fetchId === latestFetchId.current) setLoading(false);
            }
        }, 300);
    }, []);

    // Initial load with no filters
    useEffect(() => {
        triggerFetch(EMPTY_FILTERS);
        // Load saved IDs in parallel
        fetchShortlistedIds().then(setSavedIds).catch(() => { });
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, []);

    const handleFiltersChange = useCallback((f: ActiveFilters) => {
        setFilters(f);
        triggerFetch(f);
    }, [triggerFetch]);

    // Client-side text search on top of DB results
    const visibleResults = useMemo(
        () => allResults.filter((c) => matchesQuery(c, query)),
        [allResults, query],
    );

    return (
        <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
            {/* Header */}
            <View style={styles.header}>
                <BackButton onPress={onBack} />
                <Text style={styles.headerTitle}>Search</Text>
                <View style={{ width: 36 }} />
            </View>

            {/* Search input */}
            <View style={styles.searchBarWrap}>
                <View style={styles.searchBar}>
                    <Text style={styles.searchIcon}>⌕</Text>
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Name, city, keywords…"
                        placeholderTextColor="#aaa"
                        value={query}
                        onChangeText={setQuery}
                        autoCapitalize="none"
                        autoCorrect={false}
                        clearButtonMode="while-editing"
                    />
                </View>
            </View>

            {/* Filter chips */}
            <FilterBar
                filters={filters}
                onChange={handleFiltersChange}
                onClear={() => handleFiltersChange(EMPTY_FILTERS)}
            />

            {/* Results count */}
            <View style={styles.resultsMeta}>
                {loading ? (
                    <ActivityIndicator size="small" color="#123340" />
                ) : (
                    <Text style={styles.resultsCount}>
                        {visibleResults.length} {visibleResults.length === 1 ? 'profile' : 'profiles'}
                        {countActiveFilters(filters) > 0 ? ' with filters' : ''}
                        {query ? ` matching "${query}"` : ''}
                    </Text>
                )}
            </View>

            {/* Results list */}
            <ScrollView
                contentContainerStyle={[
                    styles.listContent,
                    { paddingBottom: insets.bottom + 24 },
                ]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.inner}>
                    {error ? (
                        <View style={styles.stateBox}>
                            <Text style={styles.stateEmoji}>⚠️</Text>
                            <Text style={styles.stateTitle}>Search failed</Text>
                            <Text style={styles.stateBody}>{error}</Text>
                            <Pressable
                                style={styles.stateButton}
                                onPress={() => triggerFetch(filters)}
                            >
                                <Text style={styles.stateButtonText}>Retry</Text>
                            </Pressable>
                        </View>
                    ) : !loading && visibleResults.length === 0 ? (
                        <View style={styles.stateBox}>
                            <Text style={styles.stateEmoji}>🔍</Text>
                            <Text style={styles.stateTitle}>No profiles found</Text>
                            <Text style={styles.stateBody}>
                                {countActiveFilters(filters) > 0 || query
                                    ? 'Try removing some filters or broadening your search.'
                                    : 'No profiles match your preferences yet.'}
                            </Text>
                            {(countActiveFilters(filters) > 0 || query) && (
                                <Pressable
                                    style={styles.stateButton}
                                    onPress={() => {
                                        setQuery('');
                                        handleFiltersChange(EMPTY_FILTERS);
                                    }}
                                >
                                    <Text style={styles.stateButtonText}>Clear all</Text>
                                </Pressable>
                            )}
                        </View>
                    ) : (
                        visibleResults.map((c) => (
                            <SearchResultCard
                                key={c.id}
                                candidate={c}
                                saved={savedIds.has(c.id)}
                                onPress={onSelectCandidate}
                                onBookmarkToggled={(id, s) => setSavedIds(prev => {
                                    const next = new Set(prev);
                                    if (s) next.add(id); else next.delete(id);
                                    return next;
                                })}
                            />
                        ))
                    )}
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#f4f4f6' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#fff',
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#e5e5e5',
    },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: '#111' },
    searchBarWrap: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: '#fff',
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f8fafc',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        paddingHorizontal: 12,
        height: 42,
    },
    searchIcon: { fontSize: 18, color: '#94a3b8', marginRight: 6 },
    searchInput: { flex: 1, fontSize: 15, color: '#0f172a' },
    filterContainer: {
        backgroundColor: '#fff',
        zIndex: 50,
        overflow: 'visible',
    },
    filterBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
        gap: 8,
        backgroundColor: '#fff',
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#e2e8f0',
        overflow: 'visible',
    },
    filterDropdownButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#cbd5e1',
        backgroundColor: '#f8fafc',
        flexDirection: 'row',
        alignItems: 'center',
    },
    dropdownMenu: {
        position: 'absolute',
        top: 36,
        left: 0,
        backgroundColor: '#ffffff',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#cbd5e1',
        width: 140,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 6,
        elevation: 5,
        zIndex: 1000,
    },
    dropdownOption: {
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    dropdownOptionText: {
        fontSize: 14,
        color: '#334155',
    },
    dropdownOptionTextActive: {
        color: '#14313a',
        fontWeight: '700',
    },
    filterChipActive: { borderColor: '#14313a', backgroundColor: '#14313a' },
    filterChipText: { fontSize: 13, color: '#475569', fontWeight: '500' },
    filterChipTextActive: { color: '#fff' },
    clearChip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: '#fef2f2',
        borderWidth: 1,
        borderColor: '#fca5a5',
    },
    clearChipText: { fontSize: 13, color: '#b91c1c', fontWeight: '600' },
    resultsMeta: {
        paddingHorizontal: 20,
        paddingVertical: 8,
        minHeight: 32,
        justifyContent: 'center',
    },
    resultsCount: { fontSize: 12, color: '#64748b' },
    listContent: { paddingTop: 4 },
    inner: { maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center', paddingHorizontal: 16 },
    // Card
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 14,
        padding: 12,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#f1f5f9',
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 6,
        elevation: 2,
    },
    cardPremium: {
        borderColor: '#c8a261',
        borderWidth: 2,
        backgroundColor: '#fffdf6',
    },
    cardPressed: { opacity: 0.85 },
    cardPhoto: { marginRight: 12 },
    cardImg: { width: 56, height: 56, borderRadius: 28 },
    cardImgPlaceholder: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#475569',
        alignItems: 'center',
        justifyContent: 'center',
    },
    cardImgPlaceholderText: { color: '#fff', fontSize: 18, fontWeight: '600' },
    cardBody: { flex: 1 },
    cardName: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 2 },
    cardMeta: { fontSize: 13, color: '#64748b', marginBottom: 3 },
    cardBio: { fontSize: 13, color: '#334155', lineHeight: 18 },
    cardBadge: {
        backgroundColor: '#ecfdf5',
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: '#a7f3d0',
    },
    cardBadgeText: { fontSize: 11, color: '#065f46', fontWeight: '700' },
    cardRight: {
        alignItems: 'center',
        gap: 6,
        marginLeft: 8,
    },
    // States
    stateBox: {
        alignItems: 'center',
        paddingVertical: 60,
        gap: 10,
    },
    stateEmoji: { fontSize: 40 },
    stateTitle: { fontSize: 18, fontWeight: '700', color: '#222' },
    stateBody: { fontSize: 14, color: '#777', textAlign: 'center', maxWidth: 280 },
    stateButton: {
        marginTop: 6,
        backgroundColor: '#123340',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 10,
    },
    stateButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
