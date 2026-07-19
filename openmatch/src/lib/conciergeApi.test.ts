import { fetchConciergeSession, sendIntakeMessage } from './conciergeApi';
import { supabase } from './supabase';

// Mock Supabase Client
jest.mock('./supabase', () => {
  const mockSingle = jest.fn();
  const mockMaybeSingle = jest.fn();
  const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = jest.fn(() => ({ eq: mockEq }));
  const mockFrom = jest.fn(() => ({ select: mockSelect }));
  const mockInvoke = jest.fn();

  return {
    supabase: {
      auth: {
        getUser: jest.fn(),
      },
      from: mockFrom,
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
});
