/**
 * Lightweight keyword self-check. The LLM is also instructed to avoid these
 * topics, but we double-check output before it ever reaches the review queue.
 * Flagged content is still stored (as needs_review) but marked for a human.
 *
 * Each banned topic is matched against a set of synonyms/related phrases (not
 * just its first word) so paraphrases are more likely to be caught. This is a
 * backstop before human review — not a substitute for it.
 */
export function runSafetyCheck(body: string, bannedTopics: string[]): string[] {
    const lower = ` ${body.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')} `;
    const flags = new Set<string>();

    for (const topic of bannedTopics) {
        const terms = safetyTermsForTopic(topic);
        if (terms.some((term) => lower.includes(` ${term} `) || lower.includes(`${term} `))) {
            flags.add(topic);
        }
    }
    return [...flags];
}

/**
 * Maps each banned topic to concrete words/phrases likely to appear in copy.
 * Falls back to the topic's own significant words (>3 chars) so newly added
 * banned_topics still get a baseline check.
 */
export function safetyTermsForTopic(topic: string): string[] {
    const key = topic.toLowerCase();
    const map: Record<string, string[]> = {
        'caste-based discrimination': ['caste', 'brahmin', 'kshatriya', 'gotra', 'community only', 'same caste'],
        'religious superiority': ['superior religion', 'true faith', 'only hindus', 'only muslims', 'only christians', 'convert'],
        dowry: ['dowry', 'dahej', 'gifts expected', 'car and cash'],
        'skin-tone / colourism': ['fair skin', 'fair complexion', 'gora', 'gori', 'wheatish', 'dusky', 'complexion'],
        'guaranteed marriage / results': ['guaranteed', 'guarantee', 'assured match', 'marriage guaranteed', '100% match'],
        'disparaging named competitors': ['shaadi', 'jeevansathi', 'bharat matrimony', 'bharatmatrimony', 'better than shaadi'],
    };

    if (map[key]) return map[key];
    return key
        .split(/[\s/]+/)
        .map((word) => word.trim())
        .filter((word) => word.length > 3);
}
