import {
    DEFAULT_DISCOVERY_SETTINGS,
    fetchBlockedProfiles,
    fetchDiscoverySettings,
    updateDiscoverySettings,
} from './discoverySafetyApi';
import { supabase } from './supabase';

const makeChainableMock = (data: any = null, error: any = null) => {
    const mockObj: any = {};
    const chainable = () => mockObj;

    mockObj.select = jest.fn(chainable);
    mockObj.update = jest.fn(chainable);
    mockObj.eq = jest.fn(chainable);
    mockObj.order = jest.fn(chainable);

    mockObj.maybeSingle = jest.fn().mockResolvedValue({ data, error });
    mockObj.then = (onfulfilled: any) => Promise.resolve({ data, error }).then(onfulfilled);

    return mockObj;
};

jest.mock('./supabase', () => ({
    supabase: {
        auth: { getUser: jest.fn() },
        from: jest.fn(),
    },
}));

const mockedSupabase = supabase as unknown as {
    auth: { getUser: jest.Mock };
    from: jest.Mock;
};

function signedIn(id = 'me-1') {
    mockedSupabase.auth.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
}

describe('discoverySafetyApi', () => {
    beforeEach(() => {
        jest.resetAllMocks();
    });

    describe('fetchDiscoverySettings', () => {
        it('maps the profile columns onto the settings shape', async () => {
            signedIn();
            mockedSupabase.from.mockReturnValue(
                makeChainableMock({ is_discoverable: false, incognito_mode: true }),
            );

            await expect(fetchDiscoverySettings()).resolves.toEqual({
                isDiscoverable: false,
                incognitoMode: true,
            });
            expect(mockedSupabase.from).toHaveBeenCalledWith('profiles');
        });

        it('falls back to the permissive defaults when no row exists', async () => {
            signedIn();
            mockedSupabase.from.mockReturnValue(makeChainableMock(null));

            await expect(fetchDiscoverySettings()).resolves.toEqual(DEFAULT_DISCOVERY_SETTINGS);
        });

        it('treats null columns as the defaults', async () => {
            signedIn();
            mockedSupabase.from.mockReturnValue(
                makeChainableMock({ is_discoverable: null, incognito_mode: null }),
            );

            await expect(fetchDiscoverySettings()).resolves.toEqual({
                isDiscoverable: true,
                incognitoMode: false,
            });
        });

        it('throws when the user is not signed in', async () => {
            mockedSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

            await expect(fetchDiscoverySettings()).rejects.toThrow('You must be signed in.');
        });

        it('propagates query errors', async () => {
            signedIn();
            mockedSupabase.from.mockReturnValue(makeChainableMock(null, new Error('boom')));

            await expect(fetchDiscoverySettings()).rejects.toThrow('boom');
        });
    });

    describe('updateDiscoverySettings', () => {
        it('writes only the keys present in the patch', async () => {
            signedIn();
            const chain = makeChainableMock(null);
            mockedSupabase.from.mockReturnValue(chain);

            await updateDiscoverySettings({ isDiscoverable: false });

            expect(chain.update).toHaveBeenCalledWith({ is_discoverable: false });
            expect(chain.eq).toHaveBeenCalledWith('id', 'me-1');
        });

        it('writes both columns when both are supplied', async () => {
            signedIn();
            const chain = makeChainableMock(null);
            mockedSupabase.from.mockReturnValue(chain);

            await updateDiscoverySettings({ isDiscoverable: true, incognitoMode: true });

            expect(chain.update).toHaveBeenCalledWith({
                is_discoverable: true,
                incognito_mode: true,
            });
        });

        it('is a no-op for an empty patch', async () => {
            signedIn();

            await updateDiscoverySettings({});

            expect(mockedSupabase.from).not.toHaveBeenCalled();
        });

        it('throws so the caller can roll back its optimistic update', async () => {
            signedIn();
            mockedSupabase.from.mockReturnValue(makeChainableMock(null, new Error('write failed')));

            await expect(updateDiscoverySettings({ incognitoMode: true })).rejects.toThrow('write failed');
        });
    });

    describe('fetchBlockedProfiles', () => {
        it('reads from user_blocks and flattens the joined profile', async () => {
            signedIn();
            const chain = makeChainableMock([
                {
                    blocked_id: 'blocked-1',
                    created_at: '2026-08-01T10:00:00Z',
                    profiles: {
                        id: 'blocked-1',
                        full_name: 'Rhea Kapoor',
                        location: 'Pune',
                        photo_urls: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
                    },
                },
            ]);
            mockedSupabase.from.mockReturnValue(chain);

            const result = await fetchBlockedProfiles();

            expect(mockedSupabase.from).toHaveBeenCalledWith('user_blocks');
            expect(chain.eq).toHaveBeenCalledWith('blocker_id', 'me-1');
            expect(result).toEqual([
                {
                    id: 'blocked-1',
                    fullName: 'Rhea Kapoor',
                    location: 'Pune',
                    photoUrl: 'https://cdn.example/a.jpg',
                    blockedAt: '2026-08-01T10:00:00Z',
                },
            ]);
        });

        it('keeps rows whose profile was deleted so the block can still be cleared', async () => {
            signedIn();
            mockedSupabase.from.mockReturnValue(
                makeChainableMock([
                    { blocked_id: 'gone-1', created_at: '2026-08-02T10:00:00Z', profiles: null },
                ]),
            );

            const result = await fetchBlockedProfiles();

            expect(result).toEqual([
                {
                    id: 'gone-1',
                    fullName: 'Removed account',
                    location: null,
                    photoUrl: null,
                    blockedAt: '2026-08-02T10:00:00Z',
                },
            ]);
        });

        it('returns an empty list when there are no blocks', async () => {
            signedIn();
            mockedSupabase.from.mockReturnValue(makeChainableMock(null));

            await expect(fetchBlockedProfiles()).resolves.toEqual([]);
        });

        it('propagates query errors', async () => {
            signedIn();
            mockedSupabase.from.mockReturnValue(makeChainableMock(null, new Error('rls denied')));

            await expect(fetchBlockedProfiles()).rejects.toThrow('rls denied');
        });
    });
});
