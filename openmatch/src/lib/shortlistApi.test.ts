import {
  fetchShortlist,
  fetchShortlistedIds,
  saveToShortlist,
  removeFromShortlist,
  toggleShortlist,
  shortlistToCandidate,
} from './shortlistApi';
import { supabase } from './supabase';

jest.mock('./supabase', () => {
  const mockOrder = jest.fn();
  const mockSelect = jest.fn(() => ({ order: mockOrder }));
  const mockFrom = jest.fn(() => ({ select: mockSelect }));
  const mockInsert = jest.fn();
  const mockDelete = jest.fn();
  const mockEq = jest.fn();

  return {
    supabase: {
      auth: {
        getUser: jest.fn(),
      },
      from: jest.fn((table) => {
        if (table === 'profile_shortlists') {
          return {
            select: mockSelect,
            insert: mockInsert,
            delete: jest.fn(() => ({ eq: jest.fn(() => ({ eq: mockEq })) })),
          };
        }
        if (table === 'user_blocks') {
          return {
            select: jest.fn(() => ({ or: jest.fn().mockResolvedValue({ data: [] }) })),
          };
        }
        return { select: mockSelect };
      }),
      rpc: jest.fn(),
    },
  };
});

describe('shortlistApi unit tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchShortlist', () => {
    it('should throw an error if the user is not authenticated', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: new Error('Auth error'),
      });

      await expect(fetchShortlist()).rejects.toThrow('Auth error');
    });

    it('should fetch shortlist data and filter blocked users', async () => {
      const mockUser = { id: 'user-123' };
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const mockShortlist = [
        {
          id: 'sl-1',
          saved_profile_id: 'profile-abc',
          created_at: '2026-07-19T00:00:00Z',
          saved_profile: {
            full_name: 'Abc Name',
            photo_urls: [],
          },
        },
      ];

      const mockOrder = jest.fn().mockResolvedValue({
        data: mockShortlist,
        error: null,
      });
      const mockSelect = jest.fn(() => ({ order: mockOrder }));
      (supabase.from as jest.Mock).mockImplementation((table) => {
        if (table === 'profile_shortlists') {
          return { select: mockSelect };
        }
        if (table === 'user_blocks') {
          return {
            select: jest.fn(() => ({
              or: jest.fn().mockResolvedValue({
                data: [{ blocker_id: 'user-123', blocked_id: 'profile-xyz' }],
                error: null,
              }),
            })),
          };
        }
      });

      const result = await fetchShortlist();

      expect(result).toHaveLength(1);
      expect(result[0].shortlist_id).toBe('sl-1');
      expect(result[0].full_name).toBe('Abc Name');
    });
  });

  describe('fetchShortlistedIds', () => {
    it('should throw an error if the user is not authenticated', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: new Error('Auth error'),
      });

      await expect(fetchShortlistedIds()).rejects.toThrow('Auth error');
    });

    it('should fetch saved IDs and filter out blocked profiles', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: ['profile-1', 'profile-abc'],
        error: null,
      });

      (supabase.from as jest.Mock).mockImplementation((table) => {
        if (table === 'user_blocks') {
          return {
            select: jest.fn(() => ({
              or: jest.fn().mockResolvedValue({
                data: [{ blocker_id: 'user-123', blocked_id: 'profile-abc' }],
                error: null,
              }),
            })),
          };
        }
        return { select: jest.fn() };
      });

      const result = await fetchShortlistedIds();

      expect(supabase.rpc).toHaveBeenCalledWith('get_shortlisted_profile_ids');
      expect(result.has('profile-1')).toBe(true);
      expect(result.has('profile-abc')).toBe(false);
    });
  });

  describe('saveToShortlist / removeFromShortlist / toggleShortlist', () => {
    it('should save profile to shortlist', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      (supabase.from as jest.Mock).mockReturnValue({ insert: mockInsert });

      await saveToShortlist('profile-abc');

      expect(supabase.from).toHaveBeenCalledWith('profile_shortlists');
      expect(mockInsert).toHaveBeenCalledWith({
        viewer_id: 'user-123',
        saved_profile_id: 'profile-abc',
      });
    });

    it('should remove profile from shortlist', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockEq2 = jest.fn().mockResolvedValue({ error: null });
      const mockEq1 = jest.fn(() => ({ eq: mockEq2 }));
      const mockDelete = jest.fn(() => ({ eq: mockEq1 }));
      (supabase.from as jest.Mock).mockReturnValue({ delete: mockDelete });

      await removeFromShortlist('profile-abc');

      expect(supabase.from).toHaveBeenCalledWith('profile_shortlists');
      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockEq1).toHaveBeenCalledWith('viewer_id', 'user-123');
      expect(mockEq2).toHaveBeenCalledWith('saved_profile_id', 'profile-abc');
    });

    it('should toggle shortlist correctly', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockEq2 = jest.fn().mockResolvedValue({ error: null });
      const mockEq1 = jest.fn(() => ({ eq: mockEq2 }));
      const mockDelete = jest.fn(() => ({ eq: mockEq1 }));
      const mockInsert = jest.fn().mockResolvedValue({ error: null });

      (supabase.from as jest.Mock).mockImplementation((table) => {
        if (table === 'profile_shortlists') {
          return { delete: mockDelete, insert: mockInsert };
        }
      });

      const res1 = await toggleShortlist('profile-abc', true);
      expect(res1).toBe(false);
      expect(mockDelete).toHaveBeenCalled();

      const res2 = await toggleShortlist('profile-abc', false);
      expect(res2).toBe(true);
      expect(mockInsert).toHaveBeenCalled();
    });
  });

  describe('shortlistToCandidate', () => {
    it('should convert shortlisted profile to candidate structure', () => {
      const mockProfile = {
        shortlist_id: 'sl-1',
        saved_profile_id: 'profile-abc',
        created_at: '2026-07-19T00:00:00Z',
        full_name: 'Test Candidate',
        gender: 'man',
        dob: '1995-01-01',
        location: 'Delhi',
        bio: 'Bio text',
        preferences: 'Pref text',
        photo_urls: ['url1'],
        height_cm: 175,
        profile_owner: 'self',
        partner_gender_preference: 'woman',
      };

      const result = shortlistToCandidate(mockProfile);

      expect(result.id).toBe('profile-abc');
      expect(result.full_name).toBe('Test Candidate');
      expect(result.photo_urls).toEqual(['url1']);
      expect(result.similarity).toBe(0);
    });
  });
});
