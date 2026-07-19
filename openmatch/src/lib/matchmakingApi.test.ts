import {
  fetchSemanticMatches,
  fetchCompatibilitySnapshot,
  createPendingMatch,
} from './matchmakingApi';
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
        getUser: jest.fn(),
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      },
      from: jest.fn(),
      rpc: jest.fn(),
      functions: {
        invoke: jest.fn(),
      },
    },
  };
});

describe('matchmakingApi unit tests', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('fetchSemanticMatches', () => {
    it('should throw if user is not authenticated', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
      });

      await expect(fetchSemanticMatches()).rejects.toThrow('You must be signed in to load matches.');
    });

    it('should query match feed candidates using match_profiles RPC', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      (supabase.from as jest.Mock).mockImplementation((table) => {
        if (table === 'profiles') {
          return makeChainableMock({
            embedding: [0.1, 0.2],
            onboarding_completed_at: '2026-07-19T00:00:00Z',
            gender: 'man',
            partner_gender_preference: 'woman',
          });
        }
        return makeChainableMock([]);
      });

      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: [
          { id: 'candidate-abc', full_name: 'Jane Doe', gender: 'woman' },
        ],
        error: null,
      });

      const result = await fetchSemanticMatches();

      expect(supabase.rpc).toHaveBeenCalledWith('match_profiles', {
        p_viewer_id: 'user-123',
        result_limit: 50,
        p_offset: 0,
      });
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].full_name).toBe('Jane Doe');
    });
  });

  describe('fetchCompatibilitySnapshot', () => {
    it('should invoke generate-compatibility-summary edge function', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: { summary: 'Strong compatibility match.' },
        error: null,
      });

      const result = await fetchCompatibilitySnapshot('candidate-abc');

      expect(supabase.functions.invoke).toHaveBeenCalledWith('generate-compatibility-summary', {
        body: { candidateProfileId: 'candidate-abc' },
      });
      expect(result).toBe('Strong compatibility match.');
    });
  });

  describe('createPendingMatch', () => {
    it('should call manage-match-request Edge Function to send request', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: { action: 'send', match: { id: 'match-123' }, message: null },
        error: null,
      });

      const result = await createPendingMatch('candidate-abc');

      expect(supabase.functions.invoke).toHaveBeenCalledWith('manage-match-request', {
        body: {
          action: 'send',
          candidateProfileId: 'candidate-abc',
        },
      });
      expect(result.match?.id).toBe('match-123');
    });
  });
});
