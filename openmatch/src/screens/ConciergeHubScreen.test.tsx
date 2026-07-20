import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import ConciergeHubScreen from './ConciergeHubScreen';
import { fetchConciergeSession, submitRawIntakeTranscript, fetchAssistedShortlist, updateShortlistFeedback } from '../lib/conciergeApi';

// Mock Supabase module
jest.mock('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn().mockResolvedValue({ data: { success: true }, error: null }),
    },
  },
}));

// Mock conciergeApi functions
jest.mock('../lib/conciergeApi', () => ({
  fetchConciergeSession: jest.fn(),
  sendIntakeMessage: jest.fn(),
  submitRawIntakeTranscript: jest.fn(),
  fetchAssistedShortlist: jest.fn(),
  updateShortlistFeedback: jest.fn(),
}));

describe('ConciergeHubScreen component tests', () => {
  const mockProfile = {
    id: 'test-user-id',
    full_name: 'Test Harshit',
    gender: 'man',
    partner_gender_preference: 'woman',
    photo_urls: [],
    dob: '1990-01-01',
    location: 'Mumbai',
    bio: 'Test bio',
    preferences: 'Test preferences',
    height_cm: 180,
    profile_owner: 'self' as const,
    onboarding_completed_at: '2026-07-19T00:00:00Z',
    religion: null,
    marital_status: null,
    education: null,
    diet: null,
    mother_tongue: null,
    income_band: null,
    occupation: null,
    company: null,
    complexion: null,
    family_type: null,
    family_status: null,
    num_siblings: null,
    drinks_alcohol: null,
    smokes: null,
  };

  const mockOnViewProfile = jest.fn();
  const mockOnSignOut = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should render loading screen initially', async () => {
    (fetchConciergeSession as jest.Mock).mockReturnValue(new Promise(() => {}));

    const { getByText } = render(
      <ConciergeHubScreen
        viewerProfile={mockProfile}
        onViewProfile={mockOnViewProfile}
        onSignOut={mockOnSignOut}
      />
    );

    expect(getByText('Initializing Concierge Hub...')).toBeTruthy();
  });

  it('should load session status and transition to chat if INTAKE_IN_PROGRESS', async () => {
    (fetchConciergeSession as jest.Mock).mockResolvedValue({
      id: 'session-123',
      status: 'INTAKE_IN_PROGRESS',
    });

    const { getByText, getByPlaceholderText } = render(
      <ConciergeHubScreen
        viewerProfile={mockProfile}
        onViewProfile={mockOnViewProfile}
        onSignOut={mockOnSignOut}
      />
    );

    await waitFor(() => {
      expect(getByText('AI Relationship Manager')).toBeTruthy();
      expect(getByText('Welcome to the Assisted tier! First, tell us about your daily lifestyle. Are you a morning person, night owl, or do you have a busy career schedule?')).toBeTruthy();
      expect(getByPlaceholderText('Type your answer...')).toBeTruthy();
    });
  });

  it('should go through 4 questions and submit raw transcript to Edge Function', async () => {
    (fetchConciergeSession as jest.Mock)
      .mockResolvedValueOnce({
        id: 'session-123',
        status: 'INTAKE_IN_PROGRESS',
      })
      .mockResolvedValue({
        id: 'session-123',
        status: 'AWAITING_SHORTLIST',
      });

    (submitRawIntakeTranscript as jest.Mock).mockResolvedValue({
      success: true,
      status: 'AWAITING_SHORTLIST',
    });

    const { getByPlaceholderText, getByText } = render(
      <ConciergeHubScreen
        viewerProfile={mockProfile}
        onViewProfile={mockOnViewProfile}
        onSignOut={mockOnSignOut}
      />
    );

    await waitFor(() => {
      expect(getByText('Welcome to the Assisted tier! First, tell us about your daily lifestyle. Are you a morning person, night owl, or do you have a busy career schedule?')).toBeTruthy();
    });

    const input = getByPlaceholderText('Type your answer...');
    const sendBtn = getByText('→');

    // Answer 1
    fireEvent.changeText(input, 'I am a morning person');
    await act(async () => {
      fireEvent.press(sendBtn);
      jest.advanceTimersByTime(1500);
    });

    await waitFor(() => {
      expect(getByText('Great! Next, how do you envision family dynamics? (e.g. living in a joint family vs. nuclear family, in-law involvement?)')).toBeTruthy();
    });

    // Answer 2
    fireEvent.changeText(input, 'Nuclear family preferred');
    await act(async () => {
      fireEvent.press(sendBtn);
      jest.advanceTimersByTime(1500);
    });

    await waitFor(() => {
      expect(getByText('Perfect. What are your expectations regarding career balance and sharing responsibilities at home?')).toBeTruthy();
    });

    // Answer 3
    fireEvent.changeText(input, 'Balanced work life');
    await act(async () => {
      fireEvent.press(sendBtn);
      jest.advanceTimersByTime(1500);
    });

    await waitFor(() => {
      expect(getByText('Lastly, are there any absolute deal-breakers for you beyond the standard filters (e.g., specific habits, communication styles)?')).toBeTruthy();
    });

    // Answer 4
    fireEvent.changeText(input, 'No smoking');
    await act(async () => {
      fireEvent.press(sendBtn);
      jest.advanceTimersByTime(1500);
    });

    await waitFor(() => {
      expect(submitRawIntakeTranscript).toHaveBeenCalled();
      expect(getByText('Intake Completed')).toBeTruthy();
      expect(getByText('Your dedicated RM is curating your matches...')).toBeTruthy();
    });
  });

  it('should show completion view when session status is AWAITING_SHORTLIST', async () => {
    (fetchConciergeSession as jest.Mock).mockResolvedValue({
      id: 'session-123',
      status: 'AWAITING_SHORTLIST',
      intake_notes: 'Wants morning routine, nuclear family, balanced work life, no smoking.',
    });

    const { getByText } = render(
      <ConciergeHubScreen
        viewerProfile={mockProfile}
        onViewProfile={mockOnViewProfile}
        onSignOut={mockOnSignOut}
      />
    );

    await waitFor(() => {
      expect(getByText('Intake Completed')).toBeTruthy();
      expect(getByText('Wants morning routine, nuclear family, balanced work life, no smoking.')).toBeTruthy();
      expect(getByText('Your dedicated RM is curating your matches...')).toBeTruthy();
    });
  });

  it('should render shortlist matches when status is SHORTLIST_READY', async () => {
    (fetchConciergeSession as jest.Mock).mockResolvedValue({
      id: 'session-123',
      status: 'SHORTLIST_READY',
    });

    const mockMatches = [
      {
        id: 'item-1',
        shortlist_id: 'shortlist-123',
        candidate_id: 'candidate-1',
        match_score: 0.92,
        match_rationale: 'I hand-selected Candidate A because you both love early mornings.',
        feedback_status: 'pending',
        candidate_profile: {
          id: 'candidate-1',
          full_name: 'Candidate A',
          dob: '1992-02-02',
          location: 'Pune',
          photo_urls: ['http://example.com/photo.jpg'],
          occupation: 'Doctor',
          education: 'M.B.B.S',
          diet: 'Vegetarian',
        },
      },
    ];

    (fetchAssistedShortlist as jest.Mock).mockResolvedValue(mockMatches);

    const { getByText } = render(
      <ConciergeHubScreen
        viewerProfile={mockProfile}
        onViewProfile={mockOnViewProfile}
        onSignOut={mockOnSignOut}
      />
    );

    await waitFor(() => {
      expect(getByText('Curated Shortlist')).toBeTruthy();
      expect(getByText('Candidate A, 34')).toBeTruthy();
      expect(getByText('Pune')).toBeTruthy();
      expect(getByText('I hand-selected Candidate A because you both love early mornings.')).toBeTruthy();
      expect(getByText('✕ Pass')).toBeTruthy();
      expect(getByText('💖 Like')).toBeTruthy();
    });

    fireEvent.press(getByText('Candidate A, 34'));
    expect(mockOnViewProfile).toHaveBeenCalledWith('candidate-1');
  });

  it('should trigger updateShortlistFeedback when Like button is pressed', async () => {
    (fetchConciergeSession as jest.Mock).mockResolvedValue({
      id: 'session-123',
      status: 'SHORTLIST_READY',
    });

    const mockMatches = [
      {
        id: 'item-1',
        shortlist_id: 'shortlist-123',
        candidate_id: 'candidate-1',
        match_score: 0.92,
        match_rationale: 'Reason',
        feedback_status: 'pending',
        candidate_profile: {
          id: 'candidate-1',
          full_name: 'Candidate A',
          dob: '1992-02-02',
          location: 'Pune',
          photo_urls: [],
          occupation: 'Doctor',
        },
      },
    ];

    (fetchAssistedShortlist as jest.Mock).mockResolvedValue(mockMatches);
    (updateShortlistFeedback as jest.Mock).mockResolvedValue(undefined);

    const { getByText } = render(
      <ConciergeHubScreen
        viewerProfile={mockProfile}
        onViewProfile={mockOnViewProfile}
        onSignOut={mockOnSignOut}
      />
    );

    await waitFor(() => {
      expect(getByText('💖 Like')).toBeTruthy();
    });

    const likeBtn = getByText('💖 Like');
    await act(async () => {
      fireEvent.press(likeBtn);
    });

    await waitFor(() => {
      expect(updateShortlistFeedback).toHaveBeenCalledWith('item-1', 'liked');
      expect(getByText('Liked 💖')).toBeTruthy();
    });
  });
});
