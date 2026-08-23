import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    addSearchTerm,
    clearSearchHistory,
    loadSearchHistory,
    MAX_SEARCH_HISTORY,
    recordSearchTerm,
    searchHistoryKey,
} from './searchHistory';

// The real module needs a native module that does not exist under Jest.
jest.mock('@react-native-async-storage/async-storage', () => ({
    __esModule: true,
    default: {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
    },
}));

const storage = AsyncStorage as unknown as {
    getItem: jest.Mock;
    setItem: jest.Mock;
    removeItem: jest.Mock;
};

describe('searchHistory', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        storage.setItem.mockResolvedValue(undefined);
        storage.removeItem.mockResolvedValue(undefined);
    });

    describe('addSearchTerm', () => {
        it('adds a term to the front', () => {
            expect(addSearchTerm(['delhi'], 'mumbai')).toEqual(['mumbai', 'delhi']);
        });

        it('promotes an existing term instead of duplicating it', () => {
            expect(addSearchTerm(['delhi', 'mumbai', 'pune'], 'mumbai')).toEqual([
                'mumbai',
                'delhi',
                'pune',
            ]);
        });

        it('de-duplicates case-insensitively but keeps the newest casing', () => {
            expect(addSearchTerm(['Mumbai'], 'mumbai')).toEqual(['mumbai']);
        });

        it('trims and collapses whitespace', () => {
            expect(addSearchTerm([], '  soft   spoken  ')).toEqual(['soft spoken']);
        });

        it('ignores empty or whitespace-only terms', () => {
            expect(addSearchTerm(['delhi'], '')).toEqual(['delhi']);
            expect(addSearchTerm(['delhi'], '   ')).toEqual(['delhi']);
        });

        it('caps the history length', () => {
            const full = Array.from({ length: MAX_SEARCH_HISTORY }, (_, i) => `term-${i}`);

            const result = addSearchTerm(full, 'newest');

            expect(result).toHaveLength(MAX_SEARCH_HISTORY);
            expect(result[0]).toBe('newest');
            expect(result).not.toContain(`term-${MAX_SEARCH_HISTORY - 1}`);
        });

        it('does not mutate the input array', () => {
            const original = ['delhi'];

            addSearchTerm(original, 'mumbai');

            expect(original).toEqual(['delhi']);
        });
    });

    it('namespaces the storage key per user', () => {
        expect(searchHistoryKey('abc')).toBe('openmatch:searchHistory:abc');
        expect(searchHistoryKey('abc')).not.toBe(searchHistoryKey('xyz'));
    });

    describe('loadSearchHistory', () => {
        it('returns an empty list when nothing is stored', async () => {
            storage.getItem.mockResolvedValue(null);

            await expect(loadSearchHistory('u1')).resolves.toEqual([]);
        });

        it('drops non-string and blank entries', async () => {
            storage.getItem.mockResolvedValue(JSON.stringify(['delhi', 42, '', null, ' pune ']));

            await expect(loadSearchHistory('u1')).resolves.toEqual(['delhi', 'pune']);
        });

        it('recovers from corrupt JSON instead of throwing', async () => {
            storage.getItem.mockResolvedValue('{not json');

            await expect(loadSearchHistory('u1')).resolves.toEqual([]);
        });
    });

    describe('recordSearchTerm', () => {
        it('writes the promoted history', async () => {
            storage.getItem.mockResolvedValue(JSON.stringify(['delhi']));

            const result = await recordSearchTerm('u1', 'mumbai');

            expect(result).toEqual(['mumbai', 'delhi']);
            expect(storage.setItem).toHaveBeenCalledWith(
                'openmatch:searchHistory:u1',
                JSON.stringify(['mumbai', 'delhi']),
            );
        });

        it('skips the write when the term is already most recent', async () => {
            storage.getItem.mockResolvedValue(JSON.stringify(['mumbai', 'delhi']));

            await recordSearchTerm('u1', 'mumbai');

            expect(storage.setItem).not.toHaveBeenCalled();
        });

        it('skips the write for a blank term', async () => {
            storage.getItem.mockResolvedValue(JSON.stringify(['delhi']));

            await recordSearchTerm('u1', '   ');

            expect(storage.setItem).not.toHaveBeenCalled();
        });
    });

    it('clearSearchHistory removes the key', async () => {
        await clearSearchHistory('u1');

        expect(storage.removeItem).toHaveBeenCalledWith('openmatch:searchHistory:u1');
    });
});
