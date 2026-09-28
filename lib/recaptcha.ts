// Google reCAPTCHA v3 utilities
// Client-side: executeRecaptcha() to get a token
// Server-side: verifyRecaptcha() to validate the token

const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || '';
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || '';

// Minimum score to pass verification (0.0 = bot, 1.0 = human)
const MIN_SCORE = 0.5;

/**
 * Client-side: Execute reCAPTCHA v3 and return a token.
 * Must be called in the browser after the reCAPTCHA script has loaded.
 */
export async function executeRecaptcha(action: string): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    if (!RECAPTCHA_SITE_KEY) {
        console.warn('[reCAPTCHA] NEXT_PUBLIC_RECAPTCHA_SITE_KEY not configured');
        return null;
    }

    try {
        // Wait for grecaptcha to be ready
        return await new Promise<string>((resolve, reject) => {
            const w = window as any;
            if (!w.grecaptcha) {
                reject(new Error('reCAPTCHA script not loaded'));
                return;
            }
            w.grecaptcha.ready(() => {
                w.grecaptcha
                    .execute(RECAPTCHA_SITE_KEY, { action })
                    .then(resolve)
                    .catch(reject);
            });
        });
    } catch (error) {
        console.error('[reCAPTCHA] Execute error:', error);
        return null;
    }
}

/**
 * Server-side: Verify a reCAPTCHA token with Google.
 * Returns { success, score, action } or { success: false, error }.
 */
export async function verifyRecaptcha(
    token: string,
    expectedAction?: string
): Promise<{ success: boolean; score?: number; error?: string }> {
    const disabled = process.env.RECAPTCHA_DISABLED === 'true' || !RECAPTCHA_SECRET_KEY;
    if (disabled) {
        return { success: true, score: 1.0 };
    }

    if (!token) {
        return { success: false, error: 'No reCAPTCHA token provided' };
    }

    try {
        const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                secret: RECAPTCHA_SECRET_KEY,
                response: token,
            }),
        });

        const data = await response.json();

        if (!data.success) {
            return { success: false, error: 'reCAPTCHA verification failed', score: data.score };
        }

        // Check action matches if specified
        if (expectedAction && data.action !== expectedAction) {
            return { success: false, error: 'reCAPTCHA action mismatch', score: data.score };
        }

        // Check score threshold
        if (data.score < MIN_SCORE) {
            console.warn(`[reCAPTCHA] Low score: ${data.score} for action: ${data.action}`);
            return { success: false, error: 'reCAPTCHA score too low', score: data.score };
        }

        return { success: true, score: data.score };
    } catch (error: any) {
        console.error('[reCAPTCHA] Verification error:', error.message);
        return { success: false, error: 'reCAPTCHA verification request failed' };
    }
}
