import { supabaseAdmin } from './supabase-admin';

/**
 * Shared server-side authentication utilities.
 * Use these in API routes and server actions to verify callers.
 */

export type UserRole = 'admin' | 'staff' | 'staff_pos' | 'customer';

export interface AuthResult {
    authenticated: boolean;
    user?: any;
    /** profiles.role; set whenever a role option was given. Check it for finer rules. */
    role?: UserRole | string;
    error?: string;
}

export interface VerifyAuthOptions {
    /**
     * Misnamed, kept for existing callers: true lets in ANYONE who can open
     * the dashboard (admin, staff AND staff_pos). It does not mean "admin".
     */
    requireAdmin?: boolean;
    /** With requireAdmin: admin or staff only (excludes staff_pos). */
    requireFullStaff?: boolean;
    /**
     * Exact role check, and the clear way to say who may call a route:
     *   requireRole: 'admin'               → admin only
     *   requireRole: ['admin', 'staff']    → admin or full staff (no POS)
     *   requireRole: ['admin', 'staff', 'staff_pos'] → any dashboard user
     * When set, it replaces requireAdmin/requireFullStaff.
     */
    requireRole?: UserRole | UserRole[];
}

/** The roles a set of options lets in, or null when no role check was asked for. */
function allowedRoles(options: VerifyAuthOptions): UserRole[] | null {
    if (options.requireRole) {
        return Array.isArray(options.requireRole) ? options.requireRole : [options.requireRole];
    }
    if (options.requireAdmin || options.requireFullStaff) {
        return options.requireFullStaff ? ['admin', 'staff'] : ['admin', 'staff', 'staff_pos'];
    }
    return null;
}

async function roleCheck(
    user: any,
    roles: UserRole[]
): Promise<AuthResult> {
    const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (profileError || !profile) {
        return { authenticated: false, error: 'Could not verify user role' };
    }
    const role = String(profile.role);
    if (!roles.includes(role as UserRole)) {
        return {
            authenticated: false,
            role,
            error: roles.length === 1 && roles[0] === 'admin' ? 'Administrator access required' : 'Admin access required',
        };
    }
    return { authenticated: true, user, role };
}

/**
 * Verify that the request has a valid session (signature, not banned, not
 * signed out everywhere) and optionally check the caller's role.
 *
 * - requireRole: 'admin'                 → admin only
 * - requireRole: ['admin', 'staff']      → admin or staff (no staff_pos)
 * - requireAdmin: true                   → admin, staff or staff_pos (anyone who can use the admin app)
 * - requireAdmin + requireFullStaff      → admin or staff only (excludes staff_pos)
 */
export async function verifyAuth(
    request: Request,
    options: VerifyAuthOptions = {}
): Promise<AuthResult> {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();

    if (!token) {
        return { authenticated: false, error: 'Missing authorization token' };
    }

    try {
        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

        if (error || !user) {
            return { authenticated: false, error: 'Invalid or expired token' };
        }

        const roles = allowedRoles(options);
        if (roles) return await roleCheck(user, roles);

        return { authenticated: true, user };
    } catch (err: any) {
        return { authenticated: false, error: err.message || 'Auth verification failed' };
    }
}

/**
 * Verify admin auth for server actions.
 * Requires passing the auth token from the client. With no options it lets
 * in any dashboard user (admin, staff, staff_pos); pass requireFullStaff or
 * requireRole (see verifyAuth) to narrow it.
 */
export async function verifyAdminToken(
    token: string,
    options: { requireFullStaff?: boolean; requireRole?: UserRole | UserRole[] } = {}
): Promise<AuthResult> {
    if (!token) {
        return { authenticated: false, error: 'Missing token' };
    }

    try {
        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

        if (error || !user) {
            return { authenticated: false, error: 'Invalid or expired token' };
        }

        return await roleCheck(user, allowedRoles({ requireAdmin: true, ...options })!);
    } catch (err: any) {
        return { authenticated: false, error: err.message || 'Auth failed' };
    }
}
