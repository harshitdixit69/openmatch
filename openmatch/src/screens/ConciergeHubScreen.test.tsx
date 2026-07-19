import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import ConciergeHubScreen from './ConciergeHubScreen';
import { fetchConciergeSession, sendIntakeMessage } from '../lib/conciergeApi';

// Mock conciergeApi functions
jest.mock('../lib/conciergeApi', () => ({
  fetchConciergeSession: jest.fn(),
  sendIntakeMessage: jest.fn(),
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
  });

  it('should render loading screen initially', async () => {
    // Return a promise that doesn't resolve immediately
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

    (sendIntakeMessage as jest.Mock).mockResolvedValue({
      status: 'IN_PROGRESS',
      message: 'Hello, welcome to your onboarding interview. What is your daily rhythm?',
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
      expect(getByPlaceholderText('Type your answer...')).toBeTruthy();
    });

    expect(sendIntakeMessage).toHaveBeenCalledWith([]);
  });

  it('should trigger sendIntakeMessage on message send and update chat history', async () => {
    (fetchConciergeSession as jest.Mock).mockResolvedValue({
      id: 'session-123',
      status: 'INTAKE_IN_PROGRESS',
    });

    (sendIntakeMessage as jest.Mock)
      .mockResolvedValueOnce({
        status: 'IN_PROGRESS',
        message: 'Hello, welcome to your onboarding interview. What is your daily rhythm?',
      })
      .mockResolvedValueOnce({
        status: 'IN_PROGRESS',
        message: 'Understood. Now tell me about your family goals.',
      });

    const { getByPlaceholderText, getByText } = render(
      <ConciergeHubScreen
        viewerProfile={mockProfile}
        onViewProfile={mockOnViewProfile}
        onSignOut={mockOnSignOut}
      />
    );

    await waitFor(() => {
      expect(getByText('Hello, welcome to your onboarding interview. What is your daily rhythm?')).toBeTruthy();
    });

    const input = getByPlaceholderText('Type your answer...');
    fireEvent.changeText(input, 'I am a morning person');

    const sendBtn = getByText('→');
    await act(async () => {
      fireEvent.press(sendBtn);
    });

    await waitFor(() => {
      expect(getByText('I am a morning person')).toBeTruthy();
      expect(getByText('Understood. Now tell me about your family goals.')).toBeTruthy();
    });
  });

  it('should show completion view when session status is COMPLETE', async () => {
    (fetchConciergeSession as jest.Mock).mockResolvedValue({
      id: 'session-123',
      status: 'INTAKE_COMPLETE',
      intake_notes: 'Highly traditional lifestyle preference, values early morning fitness routine, seeks a software professional partner.',
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
      expect(getByText('Highly traditional lifestyle preference, values early morning fitness routine, seeks a software professional partner.')).toBeTruthy();
    });
  });
});
