import { supabase } from './supabase';
import {
  fetchFitFrictionBreakdown,
  runOnboardingCopilot,
} from './aiApi';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  subscribeToNotifications,
} from './notificationsApi';
import {
  fetchPartnerPreferences,
  upsertPartnerPreferences,
  fetchFilteredMatches,
} from './partnerPreferencesApi';
import {
  fetchProfileViewers,
  recordProfileView,
} from './profileViewsApi';
import {
  pickProfilePhotoFromLibrary,
  uploadCurrentUserProfilePhotos,
} from './profilePhotoApi';
import {
  uploadCurrentUserVoiceIntro,
} from './voiceIntroApi';
import {
  generateRequestReasons,
  submitInterestRequest,
} from './intentEscrowApi';
import * as ImagePicker from 'expo-image-picker';

// Helper to make chainable mock
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

// Mock Expo Image Picker
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

// Mock Supabase
jest.mock('./supabase', () => {
  return {
    supabase: {
      auth: {
        getUser: jest.fn(),
        getSession: jest.fn(),
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      },
      from: jest.fn(),
      rpc: jest.fn(),
      storage: {
        from: jest.fn(),
      },
      functions: {
        invoke: jest.fn(),
      },
    },
  };
});

describe('OpenMatch Core Library API Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- aiApi tests ---
  describe('aiApi unit tests', () => {
    it('runOnboardingCopilot should generate rich personalized bio with user input', async () => {
      const result = await runOnboardingCopilot({
        full_name: 'Harshit Dixit',
        location: 'Lucknow',
        occupation: 'Software Engineer',
        religion: 'Hindu',
      });

      expect(result.bio).toContain('Harshit Dixit');
      expect(result.bio).toContain('Software Engineer');
      expect(result.bio).toContain('Lucknow');
      expect(result.preferences).toContain('Hindu');
    });

    it('fetchFitFrictionBreakdown should return compatibility fit breakdown data', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: { fitPoints: ['both like pets'], frictionPoints: ['distance'], summary: 'Good compatibility' },
        error: null,
      });

      const result = await fetchFitFrictionBreakdown('candidate-1');

      expect(supabase.functions.invoke).toHaveBeenCalledWith('generate-fit-friction-breakdown', {
        body: { candidateProfileId: 'candidate-1' },
      });
      expect(result.fitPoints).toEqual(['both like pets']);
    });
  });

  // --- notificationsApi tests ---
  describe('notificationsApi unit tests', () => {
    it('fetchNotifications should query the notifications table', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockQuery = makeChainableMock([
        {
          id: 'n-1',
          user_id: 'user-123',
          type: 'new_match',
          title: 'Match Alert',
          body: 'You have a new match!',
          is_read: false,
          created_at: '2026-07-19T00:00:00Z',
        },
      ]);
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await fetchNotifications(10);

      expect(supabase.from).toHaveBeenCalledWith('notifications');
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Match Alert');
    });

    it('markNotificationRead should update is_read flag on matching notifications', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockQuery = makeChainableMock({ error: null });
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      await markNotificationRead('n-1');

      expect(supabase.from).toHaveBeenCalledWith('notifications');
    });

    it('markNotificationRead should throw when unauthenticated', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: new Error('Auth error'),
      });

      await expect(markNotificationRead('n-1')).rejects.toThrow('Auth error');
    });

    it('markAllNotificationsRead should invoke rpc mark_all_notifications_read', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });

      await markAllNotificationsRead();

      expect(supabase.rpc).toHaveBeenCalledWith('mark_all_notifications_read', { p_user_id: 'user-123' });
    });

    it('markAllNotificationsRead should throw when unauthenticated', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: null,
      });

      await expect(markAllNotificationsRead()).rejects.toThrow('Not authenticated');
    });

    it('subscribeToNotifications should subscribe to channel and execute callback on INSERT', () => {
      let payloadHandler: Function = () => {};
      const mockChannel = {
        on: jest.fn().mockImplementation((_event: any, _filter: any, callback: Function) => {
          payloadHandler = callback;
          return mockChannel;
        }),
        subscribe: jest.fn(),
      };
      (supabase.channel as jest.Mock) = jest.fn().mockReturnValue(mockChannel);

      const onNewMock = jest.fn();
      subscribeToNotifications('user-123', onNewMock);

      expect(supabase.channel).toHaveBeenCalledWith('notifications:user-123');

      // Simulate payload
      payloadHandler({
        new: {
          id: 'n-99',
          user_id: 'user-123',
          type: 'new_match',
          title: 'New Match!',
          body: 'You matched',
          metadata: null,
          is_read: false,
          created_at: '2026-07-29T00:00:00Z',
        },
      });

      expect(onNewMock).toHaveBeenCalledWith(expect.objectContaining({
        id: 'n-99',
        type: 'new_match',
        title: 'New Match!',
      }));
    });
  });

  // --- partnerPreferencesApi tests ---
  describe('partnerPreferencesApi unit tests', () => {
    it('fetchPartnerPreferences should query profile prefs', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockQuery = makeChainableMock({
        pref_age_min: 22,
        pref_age_max: 30,
      });
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await fetchPartnerPreferences();

      expect(result?.pref_age_min).toBe(22);
      expect(result?.pref_age_max).toBe(30);
    });

    it('upsertPartnerPreferences should update profile details', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockQuery = makeChainableMock({ error: null });
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const mockPrefs = { pref_age_min: 24, pref_age_max: 28 };
      await upsertPartnerPreferences(mockPrefs);

      expect(supabase.from).toHaveBeenCalledWith('profiles');
    });

    it('fetchPartnerPreferences should return null when user is unauthenticated or query fails', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: null,
      });
      expect(await fetchPartnerPreferences()).toBeNull();

      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'u1' } },
        error: null,
      });
      const mockQuery = makeChainableMock(null, new Error('DB error'));
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);
      expect(await fetchPartnerPreferences()).toBeNull();
    });

    it('upsertPartnerPreferences should throw when unauthenticated or update fails', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: null,
      });
      await expect(upsertPartnerPreferences({})).rejects.toThrow('Not authenticated');

      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'u1' } },
        error: null,
      });
      const mockQuery = makeChainableMock(null, new Error('Update failed'));
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);
      await expect(upsertPartnerPreferences({})).rejects.toThrow('Update failed');
    });

    it('fetchFilteredMatches should pass overrides to match_profiles RPC', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'u1' } },
        error: null,
      });
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: [{ id: 'p1' }], error: null });

      const result = await fetchFilteredMatches({ pref_religion: ['Hindu'], result_limit: 20 });
      expect(supabase.rpc).toHaveBeenCalledWith('match_profiles', expect.objectContaining({
        result_limit: 20,
        p_viewer_id: 'u1',
        p_religion: ['Hindu'],
      }));
      expect(result).toEqual([{ id: 'p1' }]);
    });

    it('fetchFilteredMatches should handle error when RPC fails', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: null,
      });
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: new Error('RPC error') });

      await expect(fetchFilteredMatches({})).rejects.toThrow('RPC error');
    });
  });

  // --- profileViewsApi tests ---
  describe('profileViewsApi unit tests', () => {
    it('recordProfileView should invoke RPC to upsert view', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'viewer-id' } },
        error: null,
      });

      await recordProfileView('viewed-profile-id');

      expect(supabase.rpc).toHaveBeenCalledWith('upsert_profile_view', {
        p_viewed_id: 'viewed-profile-id',
      });
    });

    it('fetchProfileViewers should fetch viewers via RPC and filter blocks', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: [
          { viewer_id: 'viewer-abc', viewed_at: '2026-07-19T00:00:00Z' },
          { viewer_id: 'viewer-xyz', viewed_at: '2026-07-20T00:00:00Z' },
        ],
        error: null,
      });

      // Mock user_blocks check returning a block where user-123 is blocked_id
      const mockBlockQuery = {
        select: jest.fn().mockReturnThis(),
        or: jest.fn().mockResolvedValue({
          data: [{ blocker_id: 'viewer-abc', blocked_id: 'user-123' }],
        }),
      };

      // Mock profiles check returning viewer-xyz profile
      const mockProfilesQuery = {
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          data: [
            { id: 'viewer-xyz', full_name: 'XYZ User', photo_urls: ['p.jpg'], location: 'Delhi', bio: 'Bio', dob: '1998-01-01' },
          ],
          error: null,
        }),
      };

      (supabase.from as jest.Mock)
        .mockReturnValueOnce(mockBlockQuery)
        .mockReturnValueOnce(mockProfilesQuery);

      const result = await fetchProfileViewers();

      expect(result).toHaveLength(1);
      expect(result[0].viewerId).toBe('viewer-xyz');
      expect(result[0].fullName).toBe('XYZ User');
    });

    it('recordProfileView should return early if unauthenticated or viewing self', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: null,
      });
      await recordProfileView('p1');
      expect(supabase.rpc).not.toHaveBeenCalled();

      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'self-id' } },
        error: null,
      });
      await recordProfileView('self-id');
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('fetchProfileViewers should throw error when unauthenticated or RPC fails', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: null,
      });
      await expect(fetchProfileViewers()).rejects.toThrow('Not authenticated');

      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'u1' } },
        error: null,
      });
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: new Error('RPC failure') });
      await expect(fetchProfileViewers()).rejects.toThrow('RPC failure');
    });
  });

  // --- profilePhotoApi tests ---
  describe('profilePhotoApi unit tests', () => {
    it('pickProfilePhotoFromLibrary should launch image picker library', async () => {
      (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
        granted: true,
      });
      (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [{ uri: 'ph-uri', fileName: 'ph.jpg', mimeType: 'image/jpeg' }],
      });

      const result = await pickProfilePhotoFromLibrary();

      expect(result).not.toBeNull();
      expect(result?.uri).toBe('ph-uri');
    });

    it('uploadCurrentUserProfilePhotos should upload picked photos and return signed URLs', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockUpload = jest.fn().mockResolvedValue({ error: null });
      const mockCreateSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: 'https://cdn/photo.jpg?token=abc' }, error: null });
      (supabase.storage.from as jest.Mock).mockReturnValue({
        upload: mockUpload,
        createSignedUrl: mockCreateSignedUrl,
      });

      // Mock native global fetch
      global.fetch = jest.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

      const result = await uploadCurrentUserProfilePhotos([
        { id: '1', uri: 'file://photo.jpg', fileName: 'photo.jpg', mimeType: 'image/jpeg' },
      ]);

      expect(result).toEqual(['https://cdn/photo.jpg?token=abc']);
      expect(supabase.storage.from).toHaveBeenCalledWith('profile-photos');
    });
  });

  // --- voiceIntroApi tests ---
  describe('voiceIntroApi unit tests', () => {
    it('uploadCurrentUserVoiceIntro should upload audio file to storage bucket', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockUpload = jest.fn().mockResolvedValue({ error: null });
      const mockCreateSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: 'https://cdn/voice.m4a?token=abc' }, error: null });
      (supabase.storage.from as jest.Mock).mockReturnValue({
        upload: mockUpload,
        createSignedUrl: mockCreateSignedUrl,
      });

      global.fetch = jest.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

      const result = await uploadCurrentUserVoiceIntro({
        uri: 'file://voice.m4a',
        durationSeconds: 15,
        mimeType: 'audio/m4a',
      });

      expect(result).toBe('https://cdn/voice.m4a?token=abc');
      expect(supabase.storage.from).toHaveBeenCalledWith('intent-voice-intros');
    });

    it('uploadCurrentUserVoiceIntro should handle mp3, mpeg, wav, and aac mime types', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockUpload = jest.fn().mockResolvedValue({ error: null });
      const mockCreateSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: 'https://cdn/voice.mp3?token=abc' }, error: null });
      (supabase.storage.from as jest.Mock).mockReturnValue({
        upload: mockUpload,
        createSignedUrl: mockCreateSignedUrl,
      });

      global.fetch = jest.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

      await uploadCurrentUserVoiceIntro({ uri: 'file://voice.mp3', durationSeconds: 10, mimeType: 'audio/mpeg' });
      await uploadCurrentUserVoiceIntro({ uri: 'file://voice.wav', durationSeconds: 10, mimeType: 'audio/wav' });
      await uploadCurrentUserVoiceIntro({ uri: 'file://voice.aac', durationSeconds: 10, mimeType: 'audio/aac' });

      expect(mockUpload).toHaveBeenCalledTimes(3);
    });

    it('uploadCurrentUserVoiceIntro should throw on auth error, null user, or upload error', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: new Error('Auth err'),
      });
      await expect(uploadCurrentUserVoiceIntro({ uri: 'file://v.m4a', durationSeconds: 5 })).rejects.toThrow('Auth err');

      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: null,
      });
      await expect(uploadCurrentUserVoiceIntro({ uri: 'file://v.m4a', durationSeconds: 5 })).rejects.toThrow('You must be signed in to upload a voice intro.');

      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'u1' } },
        error: null,
      });
      (supabase.storage.from as jest.Mock).mockReturnValue({
        upload: jest.fn().mockResolvedValue({ error: new Error('Upload fail') }),
        createSignedUrl: jest.fn(),
      });
      await expect(uploadCurrentUserVoiceIntro({ uri: 'file://v.m4a', durationSeconds: 5 })).rejects.toThrow('Upload fail');
    });
  });

  // --- intentEscrowApi tests ---
  describe('intentEscrowApi unit tests', () => {
    it('generateRequestReasons should call Edge Function', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: {
          reasons: [
            { text: 'reason1', id: 'r1', score: 90, tags: ['tag1'] },
            { text: 'reason2', id: 'r2', score: 80, tags: ['tag2'] },
          ],
          requestQualityScore: 90,
          requiresVoiceIntro: false,
          ghostRiskScore: 10,
          activeRequestCount: 1,
          activeRequestLimit: 10,
        },
        error: null,
      });

      const mockContext = {
        candidate: { id: 'cand-1', full_name: 'Cand', photo_urls: [] } as any,
        viewerProfile: { id: 'user-1' } as any,
      };

      const result = await generateRequestReasons('cand-1', mockContext);

      expect(supabase.functions.invoke).toHaveBeenCalledWith('generate-request-reasons', {
        body: { candidateProfileId: 'cand-1', mode: 'sheet' },
      });
      expect(result.reasons[0].text).toBe('reason1');
      expect(result.reasons[1].text).toBe('reason2');
    });

    it('submitInterestRequest should submit request via Edge Function', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: {
          action: 'send',
          matchId: 'match-123',
          match: null,
          message: null,
        },
        error: null,
      });

      const result = await submitInterestRequest({
        receiverId: 'receiver-123',
        personalizedReason: 'Hello, let\'s connect.',
      });

      expect(supabase.functions.invoke).toHaveBeenCalledWith('submit-interest-request', {
        body: {
          receiverId: 'receiver-123',
          personalizedReason: 'Hello, let\'s connect.',
        },
      });
      expect(result.status).toBe('send');
    });
  });
});
