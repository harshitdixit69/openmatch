export function channelFormat(channel: string): string {
    switch (channel) {
        case 'x':
            return 'thread';
        case 'email':
            return 'email';
        case 'push':
            return 'push';
        default:
            return 'post';
    }
}

export function channelGuidance(channel: string): string {
    switch (channel) {
        case 'instagram':
            return 'Instagram: 1-2 short paragraphs, emotive hook first line, 5-10 relevant hashtags, warm tone.';
        case 'x':
            return 'X/Twitter: a punchy 3-5 tweet thread; first tweet is the hook; concise; 1-2 hashtags max.';
        case 'reddit':
            return 'Reddit: authentic, non-salesy, community-first. NO hashtags. Provide value; soft mention only.';
        case 'linkedin':
            return 'LinkedIn: professional, story-driven, product/mission framing; 3-5 hashtags.';
        case 'email':
            return 'Email: subject line in "title", friendly body, single clear CTA at the end.';
        case 'push':
            return 'Push: <10 word title, <140 char body, one clear reason to open the app.';
        default:
            return 'General social post, warm and concise.';
    }
}
