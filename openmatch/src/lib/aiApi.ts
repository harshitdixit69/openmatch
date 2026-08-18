import { ChatCopilotResult, ChatPromptSuggestions } from './chat';
import { MatchFitBreakdown } from './matchmaking';
import { OnboardingCopilotResult, ProfileInput, ProfileRevision, ProfileVariantResult, ProfileVariantTone } from './profile';
import { supabase } from './supabase';

type MaybeRecord = Record<string, unknown>;

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function asRecord(value: unknown): MaybeRecord | null {
    return value && typeof value === 'object' ? (value as MaybeRecord) : null;
}

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';

/**
 * Live Google Gemini LLM caller for authentic, dynamic AI generations.
 */
async function callGeminiJson<T>(prompt: string): Promise<T | null> {
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        temperature: 0.7,
                    },
                }),
            }
        );

        if (!response.ok) {
            console.warn(`[Gemini API] Request failed with status ${response.status}`);
            return null;
        }

        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) return null;

        return JSON.parse(rawText) as T;
    } catch (err) {
        console.warn('[Gemini API] Live AI call exception:', err);
        return null;
    }
}

/**
 * Calculates exact age in years from YYYY-MM-DD
 */
function calculateAge(dob?: string | null): number | null {
    if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
    const [y, m, d] = dob.split('-').map(Number);
    const birth = new Date(y, m - 1, d);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const mDiff = today.getMonth() - birth.getMonth();
    if (mDiff < 0 || (mDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return age >= 18 && age <= 100 ? age : null;
}

/**
 * Formats all user details into structured prompt context for AI models
 */
function formatUserDetailsPrompt(input: Partial<ProfileInput>): string {
    const age = calculateAge(input.dob);
    return [
        `- Full Name: ${input.full_name || ''}`,
        `- Gender: ${input.gender || ''}`,
        `- Looking for a: ${input.partner_gender_preference || ''}`,
        `- Date of Birth: ${input.dob || ''}${age ? ` (Age: ${age} years old)` : ''}`,
        `- Location / City: ${input.location || ''}`,
        `- Profile Managed By: ${input.profile_owner || 'self'}`,
        `- Height: ${input.height_cm ? `${input.height_cm} cm` : ''}`,
        `- Religion: ${input.religion || ''}`,
        `- Mother Tongue: ${input.mother_tongue || ''}`,
        `- Education / Qualification: ${input.education || ''}`,
        `- Profession / Occupation: ${input.occupation || ''}`,
        `- Employer / Company: ${input.company || ''}`,
        `- Annual Income: ${input.income_band || ''}`,
        `- Marital Status: ${input.marital_status || ''}`,
        `- Family Type: ${input.family_type || ''}`,
        `- Family Status: ${input.family_status || ''}`,
        `- Diet: ${input.diet || ''}`,
        `- Drinking Habits: ${input.drinks_alcohol === false ? 'No / Never' : input.drinks_alcohol === true ? 'Yes / Socially' : 'Not specified'}`,
        `- Smoking Habits: ${input.smokes === false ? 'No / Never' : input.smokes === true ? 'Yes / Socially' : 'Not specified'}`,
        `- User Notes / Current Draft: ${input.bio || 'None'}`,
        `- User Partner Notes: ${input.preferences || 'None'}`,
    ].join('\n');
}

/**
 * Generates dynamic matrimonial bio & partner expectations using live Gemini AI
 */
export async function runOnboardingCopilot(input: Partial<ProfileInput>): Promise<OnboardingCopilotResult> {
    const userPrompt = `
You are an expert matrimonial profile ghostwriter and AI copilot.
Write a personalized, creative, warm, and authentic matrimonial profile tailored specifically to the user's details.
IMPORTANT: You MUST incorporate their actual details (Name, Age, Profession, Company, Location, Education, Religion, Mother Tongue, Family background, and Lifestyle) naturally into the text. Do not use generic boilerplate text.

User details:
${formatUserDetailsPrompt(input)}

Return ONLY valid JSON with keys:
- "bio": (string) 3-4 engaging sentences highlighting their career, background, education, personality, and lifestyle.
- "preferences": (string) 3-4 thoughtful sentences describing their expectations for an ideal partner based on shared values, lifestyle, and life vision.
- "summary": (string) 1 sentence summary of their profile strengths.
- "missingTopics": (array of strings) 2-3 short suggestions of optional details they could add (e.g. "Weekend hobbies", "Relocation preferences").
`;

    // 1. Live Gemini AI Generation
    const geminiResult = await callGeminiJson<OnboardingCopilotResult>(userPrompt);
    if (geminiResult && geminiResult.bio && geminiResult.preferences && geminiResult.summary) {
        return {
            bio: geminiResult.bio.trim(),
            preferences: geminiResult.preferences.trim(),
            summary: geminiResult.summary.trim(),
            missingTopics: Array.isArray(geminiResult.missingTopics) ? geminiResult.missingTopics : [],
        };
    }

    // 2. Dynamic Smart Synthesizer fallback if offline
    return generateSmartOnboardingProfile(input);
}

/**
 * Contextual fallback synthesizer
 */
export function generateSmartOnboardingProfile(
    input: Partial<ProfileInput>,
    tone: ProfileVariantTone = 'balanced',
): OnboardingCopilotResult {
    const fullName = input.full_name?.trim() || 'I';
    const firstName = fullName.split(' ')[0];
    const age = calculateAge(input.dob);
    const gender = input.gender || 'Man';
    const partnerGender = input.partner_gender_preference || (gender === 'Man' ? 'Woman' : 'Man');
    const location = input.location?.trim() || 'India';
    const occupation = input.occupation?.trim();
    const company = input.company?.trim();
    const education = input.education?.trim();
    const religion = input.religion?.trim();
    const motherTongue = input.mother_tongue?.trim();
    const diet = input.diet?.trim();
    const familyType = input.family_type?.trim();
    const familyStatus = input.family_status?.trim();
    const drinks = input.drinks_alcohol;
    const smokes = input.smokes;
    const profileOwner = input.profile_owner || 'self';
    const heightCm = typeof input.height_cm === 'number' && input.height_cm > 0 ? input.height_cm : null;

    let heightStr = '';
    if (heightCm) {
        const totalInches = Math.round(heightCm / 2.54);
        const feet = Math.floor(totalInches / 12);
        const inches = totalInches % 12;
        heightStr = `${feet}'${inches}" (${heightCm} cm)`;
    }

    let bioGreeting = '';
    if (profileOwner === 'parent') {
        const childLabel = gender === 'Man' ? 'son' : gender === 'Woman' ? 'daughter' : 'child';
        const pronoun = gender === 'Man' ? 'He' : gender === 'Woman' ? 'She' : 'They';
        const jobPart = occupation && company
            ? `working as a ${occupation} at ${company}`
            : occupation
            ? `working as a ${occupation}`
            : company
            ? `working at ${company}`
            : 'working professional';
        bioGreeting = `We are seeking a suitable, compatible life partner for our ${childLabel}, ${fullName}${age ? ` (${age} yrs${heightStr ? `, ${heightStr}` : ''})` : ''}. ${pronoun} is currently ${jobPart} based in ${location}.`;
    } else if (profileOwner === 'sibling') {
        const siblingLabel = gender === 'Man' ? 'brother' : gender === 'Woman' ? 'sister' : 'sibling';
        const pronoun = gender === 'Man' ? 'He' : gender === 'Woman' ? 'She' : 'They';
        const jobPart = occupation && company
            ? `established as a ${occupation} at ${company}`
            : occupation
            ? `established as a ${occupation}`
            : company
            ? `working at ${company}`
            : 'a working professional';
        bioGreeting = `Creating this profile on behalf of my ${siblingLabel}, ${fullName}${age ? ` (${age} yrs${heightStr ? `, ${heightStr}` : ''})` : ''}. ${pronoun} is ${jobPart} and based in ${location}.`;
    } else {
        const jobPart = occupation && company
            ? `working as a ${occupation} at ${company}`
            : occupation
            ? `working as a ${occupation}`
            : company
            ? `working with ${company}`
            : 'working as a professional';

        if (tone === 'witty') {
            bioGreeting = `Hello there! I'm ${firstName}${age ? `, a ${age}-year-old` : ''} ${jobPart} living in ${location}.`;
        } else if (tone === 'sincere') {
            bioGreeting = `Warm greetings. My name is ${fullName}${age ? `, ${age} years old` : ''}${heightStr ? ` (${heightStr})` : ''}, currently ${jobPart} based out of ${location}.`;
        } else {
            bioGreeting = `Hello! I am ${fullName}${age ? `, a ${age}-year-old` : ''} ${jobPart} currently living and working in ${location}.`;
        }
    }

    let educationSentence = '';
    if (education && occupation) {
        educationSentence = `Having completed my ${education} degree, I am passionate about growing in my career as a ${occupation} while maintaining a grounded work-life balance.`;
    } else if (education) {
        educationSentence = `I have completed my ${education} and value dedication, continuous learning, and personal ambition.`;
    } else if (occupation) {
        educationSentence = `I take pride in my professional commitments as a ${occupation} and value stability along with personal growth.`;
    } else {
        educationSentence = `I am career-focused, sincere, and maintain an optimistic approach towards both professional and personal aspirations.`;
    }

    let familySentence = '';
    const familyParts: string[] = [];
    if (familyStatus) familyParts.push(familyStatus.toLowerCase());
    if (religion) familyParts.push(religion);
    if (familyType) familyParts.push(familyType.toLowerCase());

    if (familyParts.length > 0) {
        familySentence = `Raised in a ${familyParts.join(' ')}${motherTongue ? ` with strong ${motherTongue} cultural roots` : ''}, I hold deep respect for family traditions, mutual trust, and modern values.`;
    } else if (motherTongue) {
        familySentence = `Coming from a close-knit ${motherTongue}-speaking family, I cherish values of warmth, togetherness, and open communication.`;
    } else {
        familySentence = `I come from a loving family that has instilled in me the core values of kindness, mutual understanding, and integrity.`;
    }

    let lifestyleSentence = '';
    const habits: string[] = [];
    if (drinks === false && smokes === false) {
        habits.push('a non-smoker and non-drinker');
    } else if (drinks === false) {
        habits.push('a non-drinker');
    } else if (smokes === false) {
        habits.push('a non-smoker');
    }

    if (diet) {
        lifestyleSentence = `I follow a ${diet.toLowerCase()} diet${habits.length > 0 ? ` and am ${habits.join(' and ')}` : ''}. In my free time, I enjoy staying active, traveling, and spending quality moments with friends and family.`;
    } else if (habits.length > 0) {
        lifestyleSentence = `I am ${habits.join(' and ')}, and lead an active lifestyle with an interest in exploring new cultures, music, and fitness.`;
    } else {
        lifestyleSentence = `In my leisure time, I enjoy reading, exploring new places, and spending quality time with loved ones.`;
    }

    const bio = `${bioGreeting} ${educationSentence} ${familySentence} ${lifestyleSentence}`;

    const prefIntro = `I am seeking an educated, kind-hearted, and forward-thinking ${partnerGender}${religion ? ` from a ${religion} background` : ''}${motherTongue ? ` (or someone appreciative of ${motherTongue} traditions)` : ''}.`;
    const prefCareer = `Looking for someone with personal aspirations and career goals, who values mutual respect, honesty, and open communication.`;
    
    let prefLifestyle = '';
    if (diet === 'Vegetarian' || diet === 'Jain') {
        prefLifestyle = `A partner with similar dietary preferences (${diet.toLowerCase()} lifestyle)${smokes === false ? ' and non-smoking habits' : ''} who is based in or open to relocating to ${location} would be an ideal fit.`;
    } else {
        prefLifestyle = `Someone with a cheerful, positive outlook on life who appreciates balance between personal aspirations and family life in ${location} or nearby.`;
    }
    
    const prefClosing = `I believe marriage is a beautiful partnership built on friendship, trust, and shared dreams, and I look forward to embarking on this meaningful journey together.`;

    const preferences = `${prefIntro} ${prefCareer} ${prefLifestyle} ${prefClosing}`;
    const summary = `Personalized profile for ${fullName} (${age ? `${age} yrs, ` : ''}${occupation || 'Professional'} in ${location}) emphasizing ${religion ? `${religion} ` : ''}values and life goals.`;

    const missingTopics: string[] = [];
    if (!input.height_cm) missingTopics.push('Add height in cm');
    if (!input.company) missingTopics.push('Add employer / company name');
    if (!input.mother_tongue) missingTopics.push('Add mother tongue');
    if (!input.diet) missingTopics.push('Specify dietary preferences');

    return {
        bio,
        preferences,
        summary,
        missingTopics: missingTopics.slice(0, 3),
    };
}

export async function fetchFitFrictionBreakdown(candidateProfileId: string): Promise<MatchFitBreakdown> {
    const { data, error } = await supabase.functions.invoke('generate-fit-friction-breakdown', {
        body: { candidateProfileId },
    });

    if (error) {
        throw error;
    }

    const payload = asRecord(data);
    if (!payload) {
        throw new Error('Fit breakdown response was invalid.');
    }

    const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
    const fitPoints = isStringArray(payload.fitPoints)
        ? payload.fitPoints.map((point) => point.trim()).filter(Boolean)
        : [];
    const frictionPoints = isStringArray(payload.frictionPoints)
        ? payload.frictionPoints.map((point) => point.trim()).filter(Boolean)
        : [];

    if (!summary) {
        throw new Error('Fit breakdown response did not include a summary.');
    }

    return {
        summary,
        fitPoints,
        frictionPoints,
    };
}

export async function fetchChatPromptSuggestions(matchId: string): Promise<ChatPromptSuggestions> {
    const { data, error } = await supabase.functions.invoke('generate-chat-prompts', {
        body: { matchId },
    });

    if (error) {
        throw error;
    }

    const payload = asRecord(data);
    if (!payload || !isStringArray(payload.prompts)) {
        throw new Error('Chat prompts response was invalid.');
    }

    const prompts = payload.prompts.map((prompt) => prompt.trim()).filter(Boolean);
    if (prompts.length === 0) {
        throw new Error('Chat prompts response did not include any prompts.');
    }

    return { prompts };
}

export async function fetchChatCopilot(matchId: string): Promise<ChatCopilotResult> {
    const { data, error } = await supabase.functions.invoke('generate-chat-copilot', {
        body: { matchId },
    });

    if (error) {
        throw error;
    }

    const payload = asRecord(data);
    if (!payload || !isStringArray(payload.replySuggestions)) {
        throw new Error('Chat copilot response was invalid.');
    }

    const replySuggestions = payload.replySuggestions.map((item) => item.trim()).filter(Boolean);
    if (replySuggestions.length === 0) {
        throw new Error('Chat copilot response did not include any reply suggestions.');
    }

    const chemistryRecord = asRecord(payload.chemistry);
    const rawScore = chemistryRecord && typeof chemistryRecord.score === 'number' ? chemistryRecord.score : 0;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));
    const label =
        chemistryRecord && typeof chemistryRecord.label === 'string' && chemistryRecord.label.trim()
            ? chemistryRecord.label.trim()
            : 'Getting started';
    const signals =
        chemistryRecord && isStringArray(chemistryRecord.signals)
            ? chemistryRecord.signals.map((signal) => signal.trim()).filter(Boolean)
            : [];

    return {
        replySuggestions,
        chemistry: { score, label, signals },
    };
}

export async function generateProfileVariants(
    input: Partial<ProfileInput>,
    tone: ProfileVariantTone = 'balanced',
    refinement?: string,
    section?: 'bio' | 'preferences',
): Promise<ProfileVariantResult> {
    const prompt = `
You are an expert matrimonial profile ghostwriter.
Generate a ${tone} matrimonial profile ${section ? `specifically for the ${section} section` : ''} based on the user's details.
${refinement ? `User refinement request: "${refinement}"` : ''}

User details:
${formatUserDetailsPrompt(input)}

Return ONLY valid JSON with keys:
- "bio": (string) 3-4 sentences in ${tone} tone.
- "preferences": (string) 3-4 sentences in ${tone} tone.
- "summary": (string) 1 sentence summary.
- "tone": "${tone}"
`;

    const liveResult = await callGeminiJson<ProfileVariantResult>(prompt);
    if (liveResult && (liveResult.bio || liveResult.preferences)) {
        return {
            bio: liveResult.bio || '',
            preferences: liveResult.preferences || '',
            summary: liveResult.summary || '',
            tone: liveResult.tone || tone,
        };
    }

    const smart = generateSmartOnboardingProfile(input, tone);
    return {
        bio: smart.bio,
        preferences: smart.preferences,
        summary: smart.summary,
        tone,
    };
}

export async function fetchProfileRevisions(limit = 20): Promise<ProfileRevision[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
        .from('profile_revisions')
        .select('id, profile_id, tone, bio, preferences, source, refinement, revision_number, created_at')
        .eq('profile_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) throw error;
    return (data ?? []) as ProfileRevision[];
}

export async function saveProfileRevision(
    tone: string,
    bio: string,
    preferences: string,
    source: 'ai' | 'manual',
    refinement?: string,
): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated.');

    const { data: countData } = await supabase
        .from('profile_revisions')
        .select('revision_number')
        .eq('profile_id', user.id)
        .order('revision_number', { ascending: false })
        .limit(1);

    const nextRevision = (countData && countData.length > 0 ? (countData[0] as any).revision_number : 0) + 1;

    const { error } = await supabase
        .from('profile_revisions')
        .insert({
            profile_id: user.id,
            tone,
            bio,
            preferences,
            source,
            refinement: refinement ?? null,
            revision_number: nextRevision,
        });

    if (error) throw error;
}