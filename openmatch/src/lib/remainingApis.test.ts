import { supabase } from './supabase';
import {
  fetchFitFrictionBreakdown,
  runOnboardingCopilot,
} from './aiApi';
import {
  fetchNotifications,
  markNotificationRead,
} from './notificationsApi';
import {
  fetchPartnerPreferences,
  upsertPartnerPreferences,
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
    it('runOnboardingCopilot should call Edge Function and parse response', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: {
          bio: 'My Bio',
          preferences: 'My Prefs',
          summary: 'My Summary',
          missingTopics: ['hobbies'],
        },
        error: null,
      });

      const result = await runOnboardingCopilot({ full_name: 'Test' });

      expect(supabase.functions.invoke).toHaveBeenCalledWith('onboarding-copilot', {
        body: { full_name: 'Test' },
      });
      expect(result.bio).toBe('My Bio');
      expect(result.missingTopics).toEqual(['hobbies']);
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
        ],
        error: null,
      });

      const mockQuery = makeChainableMock([]);
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await fetchProfileViewers();

      expect(supabase.rpc).toHaveBeenCalledWith('get_profile_viewers', {
        p_viewed_id: 'user-123',
        p_limit: 50,
      });
      expect(result).toHaveLength(0);
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

    it('uploadCurrentUserProfilePhotos should upload picked photos and return public URLs', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockUpload = jest.fn().mockResolvedValue({ error: null });
      const mockGetPublicUrl = jest.fn().mockReturnValue({ data: { publicUrl: 'https://cdn/photo.jpg' } });
      (supabase.storage.from as jest.Mock).mockReturnValue({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      });

      // Mock native global fetch
      global.fetch = jest.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

      const result = await uploadCurrentUserProfilePhotos([
        { id: '1', uri: 'file://photo.jpg', fileName: 'photo.jpg', mimeType: 'image/jpeg' },
      ]);

      expect(result).toEqual(['https://cdn/photo.jpg']);
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
      const mockGetPublicUrl = jest.fn().mockReturnValue({ data: { publicUrl: 'https://cdn/voice.m4a' } });
      (supabase.storage.from as jest.Mock).mockReturnValue({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      });

      global.fetch = jest.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

      const result = await uploadCurrentUserVoiceIntro({
        uri: 'file://voice.m4a',
        durationSeconds: 15,
        mimeType: 'audio/m4a',
      });

      expect(result).toBe('https://cdn/voice.m4a');
      expect(supabase.storage.from).toHaveBeenCalledWith('intent-voice-intros');
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
