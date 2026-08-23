import React from 'react';
import { Alert, Pressable, Text } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { HomeScreen } from './HomeScreen';
import type { MatchCandidate } from '../lib/matchmaking';

const mockFetchSemanticMatches = jest.fn();
const mockFetchCurrentProfile = jest.fn();
const mockFetchCurrentProfileContactDetails = jest.fn();
const mockFetchFitFrictionBreakdown = jest.fn();
const mockFetchCompatibilitySnapshot = jest.fn();
const mockRecordPassedProfile = jest.fn();
const mockRecordHardRejectProfile = jest.fn();
const mockClearPassedProfiles = jest.fn();
const mockUpdatePresence = jest.fn();
const mockTrackPremiumEvent = jest.fn();
const mockResolvePremiumPromoVariant = jest.fn();
const mockShouldShowPremiumPopup = jest.fn();
const mockRecordPopupShown = jest.fn();
const mockRecordPopupCtaTapped = jest.fn();
const mockRecordPopupDismissed = jest.fn();
const mockUpsertContactDetails = jest.fn();
const mockPickPhoto = jest.fn();
const mockUploadPhotos = jest.fn();
const mockUpdatePhotoUrls = jest.fn();
const mockDeletePhotos = jest.fn();
const mockReact = require('react');
const mockReactNative = require('react-native');

jest.mock('../lib/matchmakingApi', () => ({
    fetchSemanticMatches: (...args: unknown[]) => mockFetchSemanticMatches(...args),
    fetchCompatibilitySnapshot: (...args: unknown[]) => mockFetchCompatibilitySnapshot(...args),
    recordPassedProfile: (...args: unknown[]) => mockRecordPassedProfile(...args),
    recordHardRejectProfile: (...args: unknown[]) => mockRecordHardRejectProfile(...args),
    clearPassedProfiles: (...args: unknown[]) => mockClearPassedProfiles(...args),
}));

jest.mock('../lib/profileApi', () => ({
    fetchCurrentProfile: (...args: unknown[]) => mockFetchCurrentProfile(...args),
    fetchCurrentProfileContactDetails: (...args: unknown[]) => mockFetchCurrentProfileContactDetails(...args),
    updateCurrentProfilePhotoUrls: (...args: unknown[]) => mockUpdatePhotoUrls(...args),
    upsertCurrentProfileContactDetails: (...args: unknown[]) => mockUpsertContactDetails(...args),
}));

jest.mock('../lib/aiApi', () => ({
    fetchFitFrictionBreakdown: (...args: unknown[]) => mockFetchFitFrictionBreakdown(...args),
}));

jest.mock('../lib/profilePhotoApi', () => ({
    maxProfilePhotos: 3,
    pickProfilePhotoFromLibrary: (...args: unknown[]) => mockPickPhoto(...args),
    uploadCurrentUserProfilePhotos: (...args: unknown[]) => mockUploadPhotos(...args),
    updateCurrentProfilePhotoUrls: (...args: unknown[]) => mockUpdatePhotoUrls(...args),
    deleteCurrentUserProfilePhotos: (...args: unknown[]) => mockDeletePhotos(...args),
}));

jest.mock('../lib/chatApi', () => ({
    updateUserPresence: (...args: unknown[]) => mockUpdatePresence(...args),
}));

jest.mock('../lib/premiumAnalytics', () => ({
    trackPremiumEvent: (...args: unknown[]) => mockTrackPremiumEvent(...args),
}));

jest.mock('../lib/premiumTargeting', () => ({
    resolvePremiumPromoVariant: (...args: unknown[]) => mockResolvePremiumPromoVariant(...args),
}));

jest.mock('../lib/premiumPopup', () => ({
    shouldShowPremiumPopup: (...args: unknown[]) => mockShouldShowPremiumPopup(...args),
    recordPremiumPopupShown: (...args: unknown[]) => mockRecordPopupShown(...args),
    recordPremiumPopupCtaTapped: (...args: unknown[]) => mockRecordPopupCtaTapped(...args),
    recordPremiumPopupDismissed: (...args: unknown[]) => mockRecordPopupDismissed(...args),
}));

jest.mock('../lib/supabase', () => ({
    supabase: {
        auth: { signOut: jest.fn().mockResolvedValue({ error: null }) },
    },
}));

jest.mock('../components/HorizontalScrollAffordance', () => ({
    HorizontalScrollAffordance: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../components/ConnectComposerSheet', () => ({
    ConnectComposerSheet: ({ visible, onSubmitted, candidate: selected }: { visible: boolean; onSubmitted?: (candidate: MatchCandidate) => void; candidate?: MatchCandidate | null }) => visible
        ? mockReact.createElement(mockReact.Fragment, null,
            mockReact.createElement(mockReactNative.Text, null, 'Connect composer'),
            mockReact.createElement(mockReactNative.Pressable, { onPress: () => onSubmitted?.(selected as MatchCandidate) }, mockReact.createElement(mockReactNative.Text, null, 'Submit connect')),
        )
        : null,
}));

jest.mock('./MatchProfileScreen', () => ({
    MatchProfileScreen: ({ onClose, onPass, onHardReject, onConnect }: { onClose: () => void; onPass: () => void; onHardReject: () => void; onConnect: () => void }) => (
        mockReact.createElement(mockReact.Fragment, null,
            mockReact.createElement(mockReactNative.Text, null, 'Compatibility profile'),
            mockReact.createElement(mockReactNative.Pressable, { onPress: onConnect }, mockReact.createElement(mockReactNative.Text, null, 'Connect from detail')),
            mockReact.createElement(mockReactNative.Pressable, { onPress: onPass }, mockReact.createElement(mockReactNative.Text, null, 'Pass from detail')),
            mockReact.createElement(mockReactNative.Pressable, { onPress: onHardReject }, mockReact.createElement(mockReactNative.Text, null, 'Block from detail')),
            mockReact.createElement(mockReactNative.Pressable, { onPress: onClose }, mockReact.createElement(mockReactNative.Text, null, 'Close detail')),
        )
    ),
}));

jest.mock('../components/PremiumPromoModal', () => ({
    PremiumPromoModal: ({ variant, onCta, onClose }: { variant: { title: string; ctaLabel: string }; onCta: () => void; onClose: () => void }) => (
        mockReact.createElement(mockReact.Fragment, null,
            mockReact.createElement(mockReactNative.Text, null, variant.title),
            mockReact.createElement(mockReactNative.Pressable, { onPress: onCta }, mockReact.createElement(mockReactNative.Text, null, variant.ctaLabel)),
            mockReact.createElement(mockReactNative.Pressable, { onPress: onClose }, mockReact.createElement(mockReactNative.Text, null, 'Dismiss premium offer')),
        )
    ),
}));

const profile = {
    id: 'viewer-1',
    full_name: 'Jordan User',
    location: 'Mumbai',
    photo_urls: [],
};

function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
    return {
        id: 'candidate-1',
        full_name: 'Aisha Sharma',
        gender: 'Woman',
        dob: '1995-05-10',
        location: 'Mumbai',
        bio: 'Enjoys thoughtful conversations and weekend travel.',
        preferences: 'vegetarian',
        photo_urls: ['https://example.com/aisha.jpg'],
        height_cm: 165,
        profile_owner: null,
        partner_gender_preference: 'Man',
        similarity: 0.92,
        distance_km: 12,
        subscription_tier: 'free',
        ...overrides,
    };
}

function feedResult(candidates: MatchCandidate[] = [candidate()], status: 'ready' | 'pending' | 'delayed' = 'ready') {
    return {
        candidates,
        viewerEmbeddingReady: status === 'ready',
        viewerEmbeddingStatus: status,
        usedLegacyFunction: false,
    };
}

function renderHome() {
    return render(<HomeScreen onOpenNotifications={jest.fn()} unreadNotificationsCount={2} />);
}

describe('HomeScreen', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFetchSemanticMatches.mockResolvedValue(feedResult());
        mockFetchCurrentProfile.mockResolvedValue(profile);
        mockFetchCurrentProfileContactDetails.mockResolvedValue({ phone_number: null, whatsapp_number: null });
        mockFetchFitFrictionBreakdown.mockResolvedValue({ summary: 'Strong fit', fitPoints: ['Values'], frictionPoints: ['Distance'] });
        mockFetchCompatibilitySnapshot.mockResolvedValue('Snapshot summary');
        mockRecordPassedProfile.mockResolvedValue(undefined);
        mockRecordHardRejectProfile.mockResolvedValue(undefined);
        mockClearPassedProfiles.mockResolvedValue(undefined);
        mockUpdatePresence.mockResolvedValue(undefined);
        mockShouldShowPremiumPopup.mockResolvedValue(false);
        mockResolvePremiumPromoVariant.mockResolvedValue({
            id: 'engaged', experimentArm: 'A', showPromo: true, shouldTrackImpression: true,
            eyebrow: 'Premium', title: 'Premium offer', body: 'Try premium', ctaLabel: 'Learn more',
            ctaNotice: 'Coming soon', impressionContext: 'test', ctaContext: 'test',
        });
    });

    it('loads and renders a ranked candidate with filters and profile facts', async () => {
        const { getByText, getByPlaceholderText } = renderHome();

        await waitFor(() => expect(getByText('Aisha Sharma')).toBeTruthy());
        expect(getByText('92% aligned')).toBeTruthy();
        expect(getByText('Woman, 31, 165 cm')).toBeTruthy();
        expect(getByText('Interested')).toBeTruthy();

        fireEvent.changeText(getByPlaceholderText('Search matches by name, city, or profile text'), 'Mumbai');
        fireEvent.press(getByText('Nearby (1)'));
        expect(getByText('Aisha Sharma')).toBeTruthy();
    });

    it('handles pass, interest, and compatibility actions', async () => {
        const { getByText, queryByText } = renderHome();
        await waitFor(() => expect(getByText('Aisha Sharma')).toBeTruthy());

        fireEvent.press(getByText('Aisha Sharma'));
        await waitFor(() => expect(getByText('Compatibility profile')).toBeTruthy());
        fireEvent.press(getByText('Close detail'));

        fireEvent.press(getByText('Interested'));
        expect(getByText('Connect composer')).toBeTruthy();
        expect(queryByText('Compatibility profile')).toBeNull();

        fireEvent.press(getByText('Pass'));
        await waitFor(() => expect(mockRecordPassedProfile).toHaveBeenCalledWith('candidate-1'));
    });

    it('renders the delayed embedding state and refreshes it', async () => {
        mockFetchSemanticMatches.mockResolvedValueOnce(feedResult([], 'delayed')).mockResolvedValueOnce(feedResult());
        const { getByText } = renderHome();

        await waitFor(() => expect(getByText('Embedding is taking longer than expected')).toBeTruthy());
        fireEvent.press(getByText('Check now'));
        await waitFor(() => expect(getByText('Aisha Sharma')).toBeTruthy());
    });

    it('renders the empty-feed state and resets passed profiles', async () => {
        mockFetchSemanticMatches.mockResolvedValue(feedResult([]));
        const { getByText } = renderHome();

        await waitFor(() => expect(getByText('No matches in feed')).toBeTruthy());
        fireEvent.press(getByText('Reset feed'));
        await waitFor(() => expect(mockClearPassedProfiles).toHaveBeenCalled());
    });

    it('shows the no-filter-results state and clears filters', async () => {
        const { getByText, getByPlaceholderText } = renderHome();
        await waitFor(() => expect(getByText('Aisha Sharma')).toBeTruthy());
        fireEvent.changeText(getByPlaceholderText('Search matches by name, city, or profile text'), 'does-not-exist');
        await waitFor(() => expect(getByText('No profiles match this view')).toBeTruthy());
        fireEvent.press(getByText('Clear filters'));
        await waitFor(() => expect(getByText('Aisha Sharma')).toBeTruthy());
    });

    it('uses the compatibility snapshot fallback when the AI breakdown fails', async () => {
        mockFetchFitFrictionBreakdown.mockRejectedValueOnce(new Error('AI unavailable'));
        const { getByText } = renderHome();
        await waitFor(() => expect(getByText('Aisha Sharma')).toBeTruthy());
        fireEvent.press(getByText('Aisha Sharma'));
        await waitFor(() => expect(mockFetchCompatibilitySnapshot).toHaveBeenCalledWith('candidate-1'));
    });

    it('renders premium and photo-less candidate branches', async () => {
        mockFetchSemanticMatches.mockResolvedValue(feedResult([
            candidate({ id: 'premium', subscription_tier: 'pro_max', photo_urls: [], similarity: 0.88 }),
            candidate({ id: 'second', full_name: 'Priya Rao', similarity: 0.86, photo_urls: ['one', 'two'] }),
            candidate({ id: 'third', full_name: 'Nina Das', similarity: 0.7 }),
        ]));
        const { getByText, getAllByText } = renderHome();
        await waitFor(() => expect(getByText('Aisha Sharma')).toBeTruthy());
        expect(getAllByText('Premium profile').length).toBeGreaterThan(0);
        expect(getByText('Add photos to stand out more')).toBeTruthy();
        expect(getByText('Priya Rao')).toBeTruthy();
        expect(getByText('Nina Das')).toBeTruthy();
    });

    it('alerts when the feed fails to load', async () => {
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
        mockFetchSemanticMatches.mockRejectedValueOnce(new Error('network down'));
        renderHome();
        await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Feed unavailable', 'network down'));
        alertSpy.mockRestore();
    });

    it('covers loading, legacy-function warning, notifications, and the pending embedding state', async () => {
        let resolveFeed: ((value: ReturnType<typeof feedResult>) => void) | undefined;
        mockFetchSemanticMatches.mockImplementationOnce(() => new Promise((resolve) => { resolveFeed = resolve; }));
        const onOpenNotifications = jest.fn();
        const { getByText, queryByText } = render(
            <HomeScreen onOpenNotifications={onOpenNotifications} unreadNotificationsCount={3} />,
        );
        expect(getByText('Building your ranked feed...')).toBeTruthy();
        resolveFeed?.({ ...feedResult([], 'pending'), usedLegacyFunction: true });
        await waitFor(() => expect(getByText('Embedding still processing')).toBeTruthy());
        expect(getByText(/older SQL function signature/)).toBeTruthy();
        expect(queryByText('Aisha Sharma')).toBeNull();
        fireEvent.press(getByText('🔔'));
        expect(onOpenNotifications).toHaveBeenCalled();
    });

    it('validates contact details and reports save failures', async () => {
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
        const { getByText, getByPlaceholderText } = render(<HomeScreen initialPhotoManagerOpen />);
        await waitFor(() => expect(getByText('Manage profile')).toBeTruthy());

        fireEvent.changeText(getByPlaceholderText('Phone number'), '123');
        fireEvent.press(getByText('Save contact details'));
        expect(alertSpy).toHaveBeenCalledWith('Invalid phone number', expect.stringContaining('8-15 digits'));

        fireEvent.changeText(getByPlaceholderText('Phone number'), '+919876543210');
        fireEvent.changeText(getByPlaceholderText('WhatsApp number'), 'bad');
        fireEvent.press(getByText('Save contact details'));
        expect(alertSpy).toHaveBeenCalledWith('Invalid WhatsApp number', expect.stringContaining('8-15 digits'));

        mockUpsertContactDetails.mockRejectedValueOnce(new Error('save failed'));
        fireEvent.changeText(getByPlaceholderText('WhatsApp number'), '');
        fireEvent.press(getByText('Save contact details'));
        await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Save failed', 'save failed'));
        alertSpy.mockRestore();
    });

    it('adds, limits, and removes profile photos', async () => {
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((title, _message, buttons) => {
            if (title === 'Remove photo?') {
                buttons?.find((button) => button.text === 'Remove')?.onPress?.();
            }
        });
        const updatedProfile = { ...profile, photo_urls: ['one', 'two'] };
        mockFetchCurrentProfile.mockResolvedValueOnce({ ...profile, photo_urls: ['one', 'two', 'three'] });
        const maxView = render(<HomeScreen initialPhotoManagerOpen />);
        await waitFor(() => expect(maxView.getByText('3 of 3 photos added')).toBeTruthy());
        expect(maxView.getByText(/reached the 3-photo limit/)).toBeTruthy();
        maxView.unmount();

        mockFetchCurrentProfile.mockResolvedValueOnce(profile);
        mockPickPhoto.mockResolvedValueOnce({ uri: 'picked' });
        mockUploadPhotos.mockResolvedValueOnce(['uploaded']);
        mockUpdatePhotoUrls.mockResolvedValue(updatedProfile);
        mockUpdatePhotoUrls.mockResolvedValueOnce(updatedProfile);
        const { getByText, getAllByText } = render(<HomeScreen initialPhotoManagerOpen />);
        await waitFor(() => expect(getByText('Manage profile')).toBeTruthy());
        fireEvent.press(getByText('Add photo'));
        await waitFor(() => expect(mockUpdatePhotoUrls).toHaveBeenCalledWith(['uploaded']));
        fireEvent.press(getAllByText('Remove')[0]);
        await waitFor(() => expect(mockDeletePhotos).toHaveBeenCalledWith(['one']));

        mockUpdatePhotoUrls.mockRejectedValueOnce(new Error('remove failed'));
        fireEvent.press(getAllByText('Remove')[0]);
        await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Photo removal failed', 'remove failed'));
        alertSpy.mockRestore();
    });

    it('handles photo upload and storage cleanup errors', async () => {
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((title, _message, buttons) => {
            if (title === 'Remove photo?') {
                buttons?.find((button) => button.text === 'Remove')?.onPress?.();
            }
        });
        mockFetchCurrentProfile.mockResolvedValue({ ...profile, photo_urls: ['existing'] });
        mockPickPhoto.mockResolvedValueOnce({ uri: 'picked' });
        mockUploadPhotos.mockRejectedValueOnce(new Error('upload failed'));
        const { getByText } = render(<HomeScreen initialPhotoManagerOpen />);
        await waitFor(() => expect(getByText('Manage profile')).toBeTruthy());
        fireEvent.press(getByText('Add photo'));
        await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Photo upload failed', 'upload failed'));

        mockUpdatePhotoUrls.mockResolvedValueOnce({ ...profile, photo_urls: ['existing'] });
        mockDeletePhotos.mockRejectedValueOnce(new Error('cleanup failed'));
        await waitFor(() => expect(getByText('Remove')).toBeTruthy());
        fireEvent.press(getByText('Remove'));
        await waitFor(() => expect(mockDeletePhotos).toHaveBeenCalledWith(['existing']));
        alertSpy.mockRestore();
    });

    it('handles detail pass, hard reject, premium popup, and popup actions', async () => {
        mockShouldShowPremiumPopup.mockResolvedValue(true);
        mockFetchSemanticMatches.mockResolvedValueOnce(feedResult([
            candidate(),
            candidate({ id: 'second', full_name: 'Priya Rao' }),
        ]));
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
        const { getByText } = renderHome();
        await waitFor(() => expect(getByText('Aisha Sharma')).toBeTruthy());

        fireEvent.press(getByText('Aisha Sharma'));
        await waitFor(() => expect(getByText('Pass from detail')).toBeTruthy());
        fireEvent.press(getByText('Pass from detail'));
        await waitFor(() => expect(mockRecordPassedProfile).toHaveBeenCalledWith('candidate-1'));

        fireEvent.press(getByText('Priya Rao'));
        await waitFor(() => expect(getByText('Block from detail')).toBeTruthy());
        fireEvent.press(getByText('Block from detail'));
        await waitFor(() => expect(mockRecordHardRejectProfile).toHaveBeenCalledWith('second'));

        // Reload with a fresh candidate so the connect/premium path is reachable.
        mockFetchSemanticMatches.mockResolvedValueOnce(feedResult([candidate({ id: 'fresh' })]));
        fireEvent.press(getByText('Reset feed'));
        await waitFor(() => expect(getByText('Aisha Sharma')).toBeTruthy());
        fireEvent.press(getByText('Interested'));
        fireEvent.press(getByText('Submit connect'));
        await waitFor(() => expect(getByText('Premium offer')).toBeTruthy());
        fireEvent.press(getByText('Learn more'));
        expect(alertSpy).toHaveBeenCalledWith('Premium coming soon', 'Coming soon');
        alertSpy.mockRestore();
    });

    it('renders the profile manager and saves contact details', async () => {
        mockUpsertContactDetails.mockResolvedValue({ phone_number: '+919876543210', whatsapp_number: null });
        mockPickPhoto.mockResolvedValue(null);

        const { getByText, getByPlaceholderText } = render(
            <HomeScreen initialPhotoManagerOpen onOpenNotifications={jest.fn()} />,
        );
        await waitFor(() => expect(getByText('Manage profile')).toBeTruthy());
        expect(getByText('No photos yet')).toBeTruthy();

        fireEvent.changeText(getByPlaceholderText('Phone number'), '+919876543210');
        fireEvent.press(getByText('Save contact details'));
        await waitFor(() => expect(mockUpsertContactDetails).toHaveBeenCalledWith({
            phone_number: '+919876543210',
            whatsapp_number: '',
        }));

        fireEvent.press(getByText('Add photo'));
        await waitFor(() => expect(mockPickPhoto).toHaveBeenCalled());
        fireEvent.press(getByText('Close'));
    });
});
