import {
  fetchChatMessages,
  sendEscrowMessage,
  setTypingIndicator,
  clearTypingIndicator,
  updateUserPresence,
  blockUser,
  unblockUser,
  reportUser,
  consumeUnlockCredit,
  declineMatchRequest,
  acceptMatchRequest,
} from './chatApi';
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
      rpc: jest.fn(() => Promise.resolve({ data: null, error: null })),
      functions: {
        invoke: jest.fn(),
      },
    },
  };
});

describe('chatApi unit tests', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('fetchChatMessages', () => {
    it('should query the messages table for match ID', async () => {
      const mockQuery = makeChainableMock([{ id: 'msg-1', content: 'hello' }]);
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await fetchChatMessages('match-123');

      expect(supabase.from).toHaveBeenCalledWith('messages');
      expect(result).toHaveLength(1);
    });
  });

  describe('sendEscrowMessage', () => {
    it('should call send-escrow-message Edge Function', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: { message: { id: 'msg-1', content: 'test' } },
        error: null,
      });

      const result = await sendEscrowMessage('match-123', 'test');

      expect(supabase.functions.invoke).toHaveBeenCalledWith('send-escrow-message', {
        body: { matchId: 'match-123', content: 'test' },
      });
      expect(result.message?.content).toBe('test');
    });
  });

  describe('setTypingIndicator & clearTypingIndicator', () => {
    it('should call typing-status Edge Function with set action', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: null,
      });

      await setTypingIndicator('match-123');

      expect(supabase.rpc).toHaveBeenCalledWith('set_typing_indicator', {
        p_match_id: 'match-123',
      });
    });

    it('should call typing-status Edge Function with clear action', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: null,
      });

      await clearTypingIndicator('match-123');

      expect(supabase.rpc).toHaveBeenCalledWith('clear_typing_indicator', {
        p_match_id: 'match-123',
      });
    });
  });

  describe('updateUserPresence', () => {
    it('should call update_user_presence RPC', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

      await updateUserPresence('online');

      expect(supabase.rpc).toHaveBeenCalledWith('update_user_presence', {
        p_status: 'online',
      });
    });
  });

  describe('blockUser & unblockUser', () => {
    it('should insert into user_blocks table to block a user', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockQuery = makeChainableMock({ error: null });
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      await blockUser('blocked-abc');

      expect(supabase.from).toHaveBeenCalledWith('user_blocks');
    });

    it('should delete from user_blocks table to unblock a user', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockQuery = makeChainableMock({ error: null });
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      await unblockUser('blocked-abc');

      expect(supabase.from).toHaveBeenCalledWith('user_blocks');
    });
  });

  describe('reportUser', () => {
    it('should insert into user_reports table', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockQuery = makeChainableMock({ error: null });
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      await reportUser('reported-abc', 'spam', 'detailed details');

      expect(supabase.from).toHaveBeenCalledWith('user_reports');
    });
  });

  describe('consumeUnlockCredit & declineMatchRequest & acceptMatchRequest', () => {
    it('should call consume_unlock_credit RPC', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: { success: true, unlocked: true },
        error: null,
      });

      const result = await consumeUnlockCredit('match-123');

      expect(supabase.rpc).toHaveBeenCalledWith('consume_unlock_credit', {
        p_match_id: 'match-123',
      });
      expect(result.success).toBe(true);
    });

    it('should call update-match-unlock Edge Function to decline', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: { action: 'decline', success: true },
        error: null,
      });

      await declineMatchRequest('match-123');

      expect(supabase.functions.invoke).toHaveBeenCalledWith('respond-interest-request', {
        body: { matchId: 'match-123', action: 'decline' },
      });
    });

    it('should call update-match-unlock Edge Function to accept', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: { action: 'accept', success: true },
        error: null,
      });

      await acceptMatchRequest('match-123');

      expect(supabase.functions.invoke).toHaveBeenCalledWith('respond-interest-request', {
        body: { matchId: 'match-123', action: 'accept' },
      });
    });
  });
});
