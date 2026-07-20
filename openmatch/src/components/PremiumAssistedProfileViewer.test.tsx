import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import PremiumAssistedProfileViewer from './PremiumAssistedProfileViewer';
import { supabase } from '../lib/supabase';
import { updateShortlistFeedback } from '../lib/conciergeApi';

// Mock Supabase module
jest.mock('../lib/supabase', () => {
  const mockSingle = jest.fn();
  const mockEq = jest.fn(() => ({ single: mockSingle }));
  const mockFrom = jest.fn(() => ({ select: jest.fn(() => ({ eq: mockEq })) }));
  const mockInvoke = jest.fn().mockResolvedValue({ data: { reply: 'AI RM reply about compatibility.' }, error: null });

  return {
    supabase: {
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null }),
      },
      from: mockFrom,
      functions: {
        invoke: mockInvoke,
      },
    },
  };
});

// Mock conciergeApi functions
jest.mock('../lib/conciergeApi', () => ({
  updateShortlistFeedback: jest.fn().mockResolvedValue(undefined),
}));

describe('PremiumAssistedProfileViewer tests', () => {
  const mockProfile = {
    id: 'candidate-123',
    full_name: 'Premium Alice',
    dob: '1995-05-05',
    location: 'Mumbai',
    bio: 'Premium bio details.',
    photo_urls: ['http://example.com/photo.jpg'],
    occupation: 'Architect',
    education: 'M.Arch',
    diet: 'Vegetarian',
    smokes: false,
    drinks_alcohol: false,
    preferences: 'Honest partner.',
    height_cm: 165,
  };

  const mockShortlistItem = {
    id: 'item-123',
    match_rationale: 'Curated because you both are vegetarians.',
    feedback_status: 'pending',
    assisted_shortlists: {
      user_id: 'user-123',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render loading state initially', () => {
    const mockFrom = supabase.from as jest.Mock;
    mockFrom.mockReturnValue({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(() => new Promise(() => {})),
        })),
      })),
    });

    const { getByText } = render(
      <PremiumAssistedProfileViewer
        profileId="candidate-123"
        onClose={jest.fn()}
      />
    );

    expect(getByText('Verifying Concierge Match details...')).toBeTruthy();
  });

  it('should load profile and shortlist item details and display them', async () => {
    const mockFrom = supabase.from as jest.Mock;
    
    // First query: profiles table
    const mockSingleProfiles = jest.fn().mockResolvedValue({
      data: mockProfile,
      error: null,
    });

    mockFrom
      .mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: mockSingleProfiles,
          })),
        })),
      })
      .mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn().mockResolvedValue({
            data: [mockShortlistItem],
            error: null,
          }),
        })),
      });

    const { getByText } = render(
      <PremiumAssistedProfileViewer
        profileId="candidate-123"
        onClose={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(getByText('Premium Alice, 31')).toBeTruthy();
      expect(getByText('📍 Mumbai')).toBeTruthy();
      expect(getByText('Curated because you both are vegetarians.')).toBeTruthy();
      expect(getByText('Architect')).toBeTruthy();
      expect(getByText('M.Arch')).toBeTruthy();
      expect(getByText('Vegetarian')).toBeTruthy();
      expect(getByText('165 cm')).toBeTruthy();
    });
  });

  it('should handle Feedback Liking successfully', async () => {
    const mockFrom = supabase.from as jest.Mock;
    
    mockFrom
      .mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn().mockResolvedValue({ data: mockProfile, error: null }),
          })),
        })),
      })
      .mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn().mockResolvedValue({
            data: [mockShortlistItem],
            error: null,
          }),
        })),
      });

    const { getByText } = render(
      <PremiumAssistedProfileViewer
        profileId="candidate-123"
        onClose={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(getByText('💖 Accept Match')).toBeTruthy();
    });

    const acceptBtn = getByText('💖 Accept Match');
    await act(async () => {
      fireEvent.press(acceptBtn);
    });

    await waitFor(() => {
      expect(updateShortlistFeedback).toHaveBeenCalledWith('item-123', 'liked');
      expect(getByText('Curated Match Accepted 💖')).toBeTruthy();
    });
  });

  it('should open compatibility chat, submit query, and receive response', async () => {
    const mockFrom = supabase.from as jest.Mock;
    
    mockFrom
      .mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn().mockResolvedValue({ data: mockProfile, error: null }),
          })),
        })),
      })
      .mockReturnValueOnce({
        select: jest.fn(() => ({
          eq: jest.fn().mockResolvedValue({
            data: [mockShortlistItem],
            error: null,
          }),
        })),
      });

    const { getByText, getByPlaceholderText } = render(
      <PremiumAssistedProfileViewer
        profileId="candidate-123"
        onClose={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(getByText('💬 Discuss candidate with your RM')).toBeTruthy();
    });

    const discussBtn = getByText('💬 Discuss candidate with your RM');
    fireEvent.press(discussBtn);

    // Chat modal is now visible
    expect(getByText('AI RM Consultant')).toBeTruthy();
    expect(getByText('Discussing Premium Alice')).toBeTruthy();

    const input = getByPlaceholderText('Ask about Premium Alice...');
    fireEvent.changeText(input, 'Tell me more about her education.');

    const sendBtn = getByText('→');
    await act(async () => {
      fireEvent.press(sendBtn);
    });

    await waitFor(() => {
      expect(supabase.functions.invoke).toHaveBeenCalledWith('discuss-candidate-chat', {
        body: {
          candidate_id: 'candidate-123',
          messages: [
            {
              role: 'assistant',
              content: 'Hello! I curated Premium Alice for you. I\'d be happy to discuss their compatibility or answer any questions you have about their lifestyle, career balance, or values. What would you like to know?',
            },
            {
              role: 'user',
              content: 'Tell me more about her education.',
            },
          ],
        },
      });
      expect(getByText('AI RM reply about compatibility.')).toBeTruthy();
    });
  });
});
