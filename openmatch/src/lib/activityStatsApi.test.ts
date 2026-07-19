import { fetchActivityStats } from './activityStatsApi';
import { supabase } from './supabase';

jest.mock('./supabase', () => {
  return {
    supabase: {
      rpc: jest.fn(),
    },
  };
});

describe('activityStatsApi unit tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call get_activity_stats RPC and return data', async () => {
    const mockStats = { totalMatches: 10, reliabilityScore: 95 };
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: mockStats,
      error: null,
    });

    const result = await fetchActivityStats();

    expect(supabase.rpc).toHaveBeenCalledWith('get_activity_stats');
    expect(result).toEqual(mockStats);
  });

  it('should throw an error if RPC returns error', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: null,
      error: new Error('RPC failed'),
    });

    await expect(fetchActivityStats()).rejects.toThrow('RPC failed');
  });

  it('should throw an error if no stats are returned', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: null,
      error: null,
    });

    await expect(fetchActivityStats()).rejects.toThrow('No stats returned');
  });
});
