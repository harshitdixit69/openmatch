import {
  fetchCurrentProfile,
  upsertCurrentProfile,
  fetchProfileContactDetails,
  upsertProfileContactDetails,
  activateSpotlight,
} from './profileApi';
import { supabase } from './supabase';

const makeChainableMock = (data: any = null, error: any = null) => {
  const mockObj: any = {};
  const chainable = () => mockObj;

  mockObj.select = jest.fn(chainable);
  mockObj.insert = jest.fn(chainable);
  mockObj.update = jest.fn(chainable);
  mockObj.delete = jest.fn(chainable);
  mockObj.upsert = jest.fn(chainable);
  mockObj.eq = jest.fn(chainable);
  mockObj.or = jest.fn(chainable);
  mockObj.in = jest.fn(chainable);
  mockObj.order = jest.fn(chainable);
  mockObj.limit = jest.fn(chainable);
  mockObj.returns = jest.fn(chainable);

  mockObj.single = jest.fn().mockResolvedValue({ data, error });
  mockObj.maybeSingle = jest.fn().mockResolvedValue({ data, error });
  mockObj.then = (onfulfilled: any) => Promise.resolve({ data, error }).then(onfulfilled);

  return mockObj;
};

jest.mock('./supabase', () => {
  return {
    supabase: {
      auth: {
        getSession: jest.fn(),
        getUser: jest.fn(),
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      },
      from: jest.fn(),
      rpc: jest.fn(),
    },
  };
});

describe('profileApi unit tests', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('fetchCurrentProfile', () => {
    it('should return null if no active session', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const result = await fetchCurrentProfile();
      expect(result).toBeNull();
    });

    it('should return profile data for authenticated user', async () => {
      const mockSession = { user: { id: 'user-123' } };
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockQuery = makeChainableMock({ id: 'user-123', full_name: 'Test Harshit' });
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await fetchCurrentProfile();

      expect(result).not.toBeNull();
      expect(result?.full_name).toBe('Test Harshit');
    });
  });

  describe('upsertCurrentProfile', () => {
    it('should throw an error if no active session user', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: null,
      });

      await expect(upsertCurrentProfile({ full_name: 'New Name' })).rejects.toThrow('You must be signed in to save a profile.');
    });

    it('should update and upsert profile data', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: { user: { id: 'user-123' } } },
        error: null,
      });
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockQuery = makeChainableMock({ id: 'user-123', full_name: 'Updated Name' });
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await upsertCurrentProfile({ full_name: 'Updated Name' });

      expect(supabase.from).toHaveBeenCalledWith('profiles');
      expect(result.full_name).toBe('Updated Name');
    });
  });

  describe('activateSpotlight', () => {
    it('should trigger activate_spotlight RPC', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const result = await activateSpotlight();

      expect(supabase.rpc).toHaveBeenCalledWith('activate_spotlight');
      expect(result).toEqual({ success: true });
    });
  });
});
