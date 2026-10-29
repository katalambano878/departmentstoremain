import { emailButton, emailLayout, sendEmail } from '@/lib/notifications';

/** Account emails hosted Supabase used to send: signup confirmation and password reset. */

export async function sendSignupConfirmationEmail(to: string, link: string) {
    const body = `
        <h1 style="margin:0 0 12px;font-size:22px;color:#111827;">Confirm your email</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
            Thanks for creating an account. Confirm this email address to finish setting it up.
        </p>
        ${emailButton('Confirm my email', link)}
        <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">
            This link works once and expires in 24 hours. If you did not create an account, you can ignore this email.
        </p>`;
    return sendEmail({
        to,
        subject: 'Confirm your email address',
        html: emailLayout(body, 'Confirm your email to finish creating your account'),
    });
}

export async function sendPasswordResetEmail(to: string, link: string) {
    const body = `
        <h1 style="margin:0 0 12px;font-size:22px;color:#111827;">Reset your password</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
            We received a request to reset the password for this account. Choose a new password with the button below.
        </p>
        ${emailButton('Choose a new password', link)}
        <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">
            This link works once and expires in 1 hour. If you did not ask to reset your password, you can ignore this email; your password stays the same.
        </p>`;
    return sendEmail({
        to,
        subject: 'Reset your password',
        html: emailLayout(body, 'Choose a new password for your account'),
    });
}
