'use client';

import { useCallback, useState } from 'react';
import { executeRecaptcha } from '@/lib/recaptcha';

/**
 * React hook for reCAPTCHA v3 integration.
 * Returns a function to get a verified token, plus loading/error state.
 * 
 * Usage:
 *   const { getToken, verifying } = useRecaptcha();
 *   
 *   async function handleSubmit() {
 *     const isHuman = await getToken('signup');
 *     if (!isHuman) return; // Failed verification
 *     // Proceed with form submission...
 *   }
 */
export function useRecaptcha() {
    const [verifying, setVerifying] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const getToken = useCallback(async (action: string): Promise<boolean> => {
        setError(null);

        const disabled =
            process.env.NEXT_PUBLIC_RECAPTCHA_DISABLED === 'true' ||
            !process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
        if (disabled) {
            return true;
        }

        setVerifying(true);
        try {
            const token = await executeRecaptcha(action);
            if (!token) {
                setError('Could not get reCAPTCHA token. Please try again.');
                return false;
            }

            // Verify on server side
            const response = await fetch('/api/recaptcha/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, action }),
            });

            const result = await response.json();
            if (!result.success) {
                setError(result.error || 'Verification failed. Please try again.');
                return false;
            }

            return true;
        } catch (err: any) {
            console.error('[reCAPTCHA] Hook error:', err);
            setError('Verification error. Please try again.');
            return false;
        } finally {
            setVerifying(false);
        }
    }, []);

    return { getToken, verifying, error, clearError: () => setError(null) };
}
