import { ChatCopilotResult, ChatPromptSuggestions } from './chat';
import { MatchFitBreakdown } from './matchmaking';
import { OnboardingCopilotResult, ProfileInput } from './profile';
import { supabase } from './supabase';

type MaybeRecord = Record<string, unknown>;

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function asRecord(value: unknown): MaybeRecord | null {
    return value && typeof value === 'object' ? (value as MaybeRecord) : null;
}

export async function runOnboardingCopilot(input: Partial<ProfileInput>): Promise<OnboardingCopilotResult> {
    const { data, error } = await supabase.functions.invoke('onboarding-copilot', {
        body: input,
    });

    if (error) {
        throw error;
    }

    const payload = asRecord(data);
    if (!payload) {
        throw new Error('Onboarding copilot response was invalid.');
    }

    const bio = typeof payload.bio === 'string' ? payload.bio.trim() : '';
    const preferences = typeof payload.preferences === 'string' ? payload.preferences.trim() : '';
    const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
    const missingTopics = isStringArray(payload.missingTopics)
        ? payload.missingTopics.map((topic) => topic.trim()).filter(Boolean)
        : [];

    if (!bio || !preferences || !summary) {
        throw new Error('Onboarding copilot response was incomplete.');
    }

    return {
        bio,
        preferences,
        summary,
        missingTopics,
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