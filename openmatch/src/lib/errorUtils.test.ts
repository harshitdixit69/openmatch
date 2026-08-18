import { getFriendlyErrorMessage } from './errorUtils';

describe('errorUtils - getFriendlyErrorMessage', () => {
    it('handles Invalid API key errors gracefully', () => {
        const msg = getFriendlyErrorMessage({ message: 'Invalid API key' });
        expect(msg).toBe('Unable to connect to the authentication service. Please try again shortly or check your network.');
    });

    it('handles UNAUTHORIZED_INVALID_API_KEY from Supabase', () => {
        const msg = getFriendlyErrorMessage({ error_code: 'UNAUTHORIZED_INVALID_API_KEY', message: 'Unauthorized' });
        expect(msg).toBe('Unable to connect to the authentication service. Please try again shortly or check your network.');
    });

    it('handles Invalid login credentials', () => {
        const msg = getFriendlyErrorMessage({ message: 'Invalid login credentials' });
        expect(msg).toBe('Incorrect email or password. Please verify your details and try again.');
    });

    it('handles network failure', () => {
        const msg = getFriendlyErrorMessage(new Error('Network request failed'));
        expect(msg).toBe('No internet connection detected. Please check your network and try again.');
    });

    it('handles unconfirmed email', () => {
        const msg = getFriendlyErrorMessage({ message: 'Email not confirmed' });
        expect(msg).toBe('Please check your email inbox and confirm your address before signing in.');
    });

    it('handles user already registered', () => {
        const msg = getFriendlyErrorMessage({ message: 'User already registered' });
        expect(msg).toBe('An account with this email or phone number already exists. Please sign in instead.');
    });

    it('handles rate limit errors', () => {
        const msg = getFriendlyErrorMessage({ message: 'over_email_send_rate_limit' });
        expect(msg).toBe('Too many attempts. Please wait a few minutes before trying again.');
    });

    it('handles internal PostgREST database errors by returning friendly fallback', () => {
        const msg = getFriendlyErrorMessage({ message: 'PGRST116: JSON object requested, multiple (or no) rows returned' }, 'Could not load your profile.');
        expect(msg).toBe('Could not load your profile.');
    });

    it('preserves clean user-facing validation strings', () => {
        const msg = getFriendlyErrorMessage('Please enter a valid mobile number (10 digits).');
        expect(msg).toBe('Please enter a valid mobile number (10 digits).');
    });

    it('returns default fallback when error is null or undefined', () => {
        const msg = getFriendlyErrorMessage(null, 'Custom fallback error');
        expect(msg).toBe('Custom fallback error');
    });
});
