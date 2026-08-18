import { generateSmartOnboardingProfile, runOnboardingCopilot } from './aiApi';
import { supabase } from './supabase';

jest.mock('./supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
  },
}));

describe('aiApi - Smart Matrimonial Profile Generation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('generateSmartOnboardingProfile generates rich personalized bio matching user details', () => {
    const profile = generateSmartOnboardingProfile({
      full_name: 'Aarav Sharma',
      gender: 'Man',
      partner_gender_preference: 'Woman',
      dob: '1996-05-15',
      location: 'Agra',
      occupation: 'Software Engineer',
      company: 'Google',
      education: 'B.Tech in Computer Science',
      religion: 'Hindu',
      mother_tongue: 'Hindi',
      diet: 'Vegetarian',
      family_type: 'Nuclear Family',
      family_status: 'Upper Middle Class',
      drinks_alcohol: false,
      smokes: false,
      height_cm: 178,
      profile_owner: 'self',
    });

    expect(profile.bio).toContain('Aarav Sharma');
    expect(profile.bio).toContain('Software Engineer');
    expect(profile.bio).toContain('Google');
    expect(profile.bio).toContain('Agra');
    expect(profile.bio).toContain('B.Tech in Computer Science');
    expect(profile.bio).toContain('Hindu');
    expect(profile.bio).toContain('Hindi');
    expect(profile.bio).toContain('vegetarian');
    expect(profile.bio).toContain('non-smoker and non-drinker');

    expect(profile.preferences).toContain('Woman');
    expect(profile.preferences).toContain('Hindu');
    expect(profile.preferences).toContain('Agra');
    expect(profile.preferences).toContain('vegetarian');
  });

  it('generateSmartOnboardingProfile handles parent profile manager gracefully', () => {
    const profile = generateSmartOnboardingProfile({
      full_name: 'Pooja Verma',
      gender: 'Woman',
      partner_gender_preference: 'Man',
      dob: '1998-10-20',
      location: 'Lucknow',
      occupation: 'Doctor',
      company: 'Apollo Hospital',
      education: 'MBBS',
      religion: 'Hindu',
      profile_owner: 'parent',
    });

    expect(profile.bio).toContain('daughter');
    expect(profile.bio).toContain('Pooja Verma');
    expect(profile.bio).toContain('Doctor');
    expect(profile.bio).toContain('Apollo Hospital');
    expect(profile.bio).toContain('Lucknow');
    expect(profile.preferences).toContain('Man');
  });

  it('runOnboardingCopilot falls back to dynamic smart synthesizer when edge fn fails', async () => {
    (supabase.functions.invoke as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const result = await runOnboardingCopilot({
      full_name: 'Rohan Mehta',
      location: 'Delhi',
      occupation: 'Financial Analyst',
      dob: '1995-03-12',
    });

    expect(result.bio).toContain('Rohan Mehta');
    expect(result.bio).toContain('Financial Analyst');
    expect(result.bio).toContain('Delhi');
    expect(result.preferences).toContain('Delhi');
  });
});
