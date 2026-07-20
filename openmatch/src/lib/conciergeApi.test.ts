import { fetchConciergeSession, sendIntakeMessage, submitRawIntakeTranscript, fetchAssistedShortlist, updateShortlistFeedback } from './conciergeApi';
import { supabase } from './supabase';

// Mock Supabase Client
jest.mock('./supabase', () => {
  const mockSingle = jest.fn();
  const mockMaybeSingle = jest.fn();
  const mockEq = jest.fn();
  const mockSelect = jest.fn();
  const mockFrom = jest.fn();
  const mockInvoke = jest.fn();

  const mockBuilder = {
    select: mockSelect,
    update: jest.fn(() => mockBuilder),
    eq: mockEq,
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
  };

  mockSelect.mockReturnValue(mockBuilder);
  mockEq.mockReturnValue(mockBuilder);

  return {
    supabase: {
      auth: {
        getUser: jest.fn(),
      },
      from: mockFrom.mockReturnValue(mockBuilder),
      functions: {
        invoke: mockInvoke,
      },
    },
  };
});

describe('conciergeApi unit tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchConciergeSession', () => {
    it('should throw an error if the user is not authenticated', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
      });

      await expect(fetchConciergeSession()).rejects.toThrow('Not authenticated');
    });

    it('should query the assisted_concierge_sessions table and return data', async () => {
      const mockUser = { id: 'test-user-id' };
      const mockSession = { id: 'session-id', status: 'INTAKE_IN_PROGRESS' };

      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: mockUser },
      });

      const mockMaybeSingle = jest.fn().mockResolvedValue({
        data: mockSession,
        error: null,
      });
      const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
      const mockSelect = jest.fn(() => ({ eq: mockEq }));
      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      const result = await fetchConciergeSession();

      expect(supabase.auth.getUser).toHaveBeenCalledTimes(1);
      expect(supabase.from).toHaveBeenCalledWith('assisted_concierge_sessions');
      expect(mockSelect).toHaveBeenCalledWith('id, user_id, status, intake_notes, intake_completed_at, created_at, updated_at');
      expect(mockEq).toHaveBeenCalledWith('user_id', 'test-user-id');
      expect(result).toEqual(mockSession);
    });

    it('should throw an error if query fails', async () => {
      const mockUser = { id: 'test-user-id' };
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: mockUser },
      });

      const mockMaybeSingle = jest.fn().mockResolvedValue({
        data: null,
        error: new Error('Database error'),
      });
      const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
      const mockSelect = jest.fn(() => ({ eq: mockEq }));
      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      await expect(fetchConciergeSession()).rejects.toThrow('Database error');
    });
  });

  describe('sendIntakeMessage', () => {
    it('should invoke the concierge-intake-chat Edge Function and return data', async () => {
      const mockInput = [{ role: 'user' as const, content: 'Hello' }];
      const mockResponse = { status: 'IN_PROGRESS', message: 'Hi there' };

      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: mockResponse,
        error: null,
      });

      const result = await sendIntakeMessage(mockInput);

      expect(supabase.functions.invoke).toHaveBeenCalledWith('concierge-intake-chat', {
        body: { messages: mockInput },
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw an error if function invocation fails', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: null,
        error: new Error('Edge function error'),
      });

      await expect(sendIntakeMessage([])).rejects.toThrow('Edge function error');
    });

    it('should throw an error if returned response data is invalid', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: { invalid_field: 'unknown' },
        error: null,
      });

      await expect(sendIntakeMessage([])).rejects.toThrow('Invalid response from concierge intake.');
    });
  });

  describe('submitRawIntakeTranscript', () => {
    it('should invoke process-concierge-intake Edge Function', async () => {
      const mockResponse = { success: true, status: 'AWAITING_SHORTLIST' };
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: mockResponse,
        error: null,
      });

      const result = await submitRawIntakeTranscript('User: Hi\nAI RM: Hello');

      expect(supabase.functions.invoke).toHaveBeenCalledWith('process-concierge-intake', {
        body: { transcript: 'User: Hi\nAI RM: Hello' },
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw error if invocation fails', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: null,
        error: new Error('Invocation failed'),
      });

      await expect(submitRawIntakeTranscript('test')).rejects.toThrow('Invocation failed');
    });
  });

  describe('fetchAssistedShortlist', () => {
    it('should query assisted_shortlists and assisted_shortlist_items and map profiles', async () => {
      const mockShortlist = { id: 'shortlist-123' };
      const mockItems = [
        {
          id: 'item-1',
          shortlist_id: 'shortlist-123',
          candidate_id: 'candidate-1',
          match_score: 0.95,
          match_rationale: 'Great match!',
          feedback_status: 'pending',
          created_at: '2026-07-20T00:00:00Z',
          profiles: {
            id: 'candidate-1',
            full_name: 'Candidate A',
          },
        },
      ];

      const mockBuilderShortlist: any = {
        select: jest.fn(() => mockBuilderShortlist),
        eq: jest.fn(() => mockBuilderShortlist),
        maybeSingle: jest.fn().mockResolvedValue({ data: mockShortlist, error: null }),
      };

      const mockBuilderItems: any = {
        select: jest.fn(() => mockBuilderItems),
        eq: jest.fn().mockResolvedValue({ data: mockItems, error: null }),
      };

      (supabase.from as jest.Mock)
        .mockReturnValueOnce(mockBuilderShortlist)
        .mockReturnValueOnce(mockBuilderItems);

      const result = await fetchAssistedShortlist('session-123');

      expect(supabase.from).toHaveBeenNthCalledWith(1, 'assisted_shortlists');
      expect(supabase.from).toHaveBeenNthCalledWith(2, 'assisted_shortlist_items');
      expect(result).toEqual([
        {
          id: 'item-1',
          shortlist_id: 'shortlist-123',
          candidate_id: 'candidate-1',
          match_score: 0.95,
          match_rationale: 'Great match!',
          feedback_status: 'pending',
          created_at: '2026-07-20T00:00:00Z',
          candidate_profile: {
            id: 'candidate-1',
            full_name: 'Candidate A',
          },
        },
      ]);
    });

    it('should return empty array if no active shortlist exists', async () => {
      const mockBuilderShortlist: any = {
        select: jest.fn(() => mockBuilderShortlist),
        eq: jest.fn(() => mockBuilderShortlist),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockBuilderShortlist);

      const result = await fetchAssistedShortlist('session-123');
      expect(result).toEqual([]);
    });
  });

  describe('updateShortlistFeedback', () => {
    it('should update assisted_shortlist_items status', async () => {
      const mockBuilderUpdate: any = {
        update: jest.fn(() => mockBuilderUpdate),
        eq: jest.fn().mockResolvedValue({ error: null }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockBuilderUpdate);

      await updateShortlistFeedback('item-123', 'liked');

      expect(supabase.from).toHaveBeenCalledWith('assisted_shortlist_items');
      expect(mockBuilderUpdate.update).toHaveBeenCalledWith({ feedback_status: 'liked' });
      expect(mockBuilderUpdate.eq).toHaveBeenCalledWith('id', 'item-123');
    });

    it('should throw error if update fails', async () => {
      const mockBuilderUpdate: any = {
        update: jest.fn(() => mockBuilderUpdate),
        eq: jest.fn().mockResolvedValue({ error: new Error('Update failed') }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockBuilderUpdate);

      await expect(updateShortlistFeedback('item-123', 'liked')).rejects.toThrow('Update failed');
    });
  });
});
