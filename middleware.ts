import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// The middleware runs on the edge and cannot reach the database. It checks the
// session signature itself, then asks the app (same container, over loopback)
// for the live role and the maintenance settings, so a demoted or banned
// staff member loses the dashboard at once, as with the hosted Supabase check.
const INTERNAL_ORIGIN = `http://127.0.0.1:${process.env.PORT || 3000}`;

const MAINTENANCE_CACHE_TTL_MS = 30 * 1000;
let maintenanceCache: {
    enabled: boolean;
    until: string;
    message: string;
    fetchedAt: number;
} | null = null;

const ROLE_CACHE_TTL_MS = 30 * 1000;
const roleCache = new Map<string, { userId: string; role: string; fetchedAt: number }>();

function extractAuthToken(request: NextRequest): string | undefined {
    // Set by the admin login page and kept fresh by the admin layout.
    return request.cookies.get('sb-access-token')?.value || undefined;
}

async function getRoleFromToken(token: string): Promise<{ userId: string; role: string } | null> {
    const secret = process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET;
    if (!secret) return null;
    try {
        const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
        if (payload.typ === 'refresh' || typeof payload.sub !== 'string') return null;
    } catch {
        return null;
    }

    const now = Date.now();
    const cached = roleCache.get(token);
    if (cached && now - cached.fetchedAt < ROLE_CACHE_TTL_MS) {
        return { userId: cached.userId, role: cached.role };
    }
    try {
        const res = await fetch(`${INTERNAL_ORIGIN}/api/auth/session-role`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { userId?: string; role?: string };
        if (!body.userId || !body.role) return null;
        if (roleCache.size > 500) roleCache.clear();
        roleCache.set(token, { userId: body.userId, role: body.role, fetchedAt: now });
        return { userId: body.userId, role: body.role };
    } catch {
        return null;
    }
}

function maintenanceFromEnv(): { enabled: boolean; until: string; message: string } | null {
    if (process.env.MAINTENANCE_MODE !== 'true') return null;
    return {
        enabled: true,
        until: '',
        message: process.env.MAINTENANCE_MESSAGE?.trim() || '',
    };
}

function visitorWaitFinished(request: NextRequest): boolean {
    const raw = request.cookies.get('ddz_wait_until')?.value;
    const endsAt = Number(raw);
    return Number.isFinite(endsAt) && endsAt > 0 && endsAt <= Date.now();
}

async function getMaintenanceSettings(): Promise<{ enabled: boolean; until: string; message: string }> {
    const fromEnv = maintenanceFromEnv();
    if (fromEnv) return fromEnv;

    const now = Date.now();
    if (maintenanceCache && now - maintenanceCache.fetchedAt < MAINTENANCE_CACHE_TTL_MS) {
        return {
            enabled: maintenanceCache.enabled,
            until: maintenanceCache.until,
            message: maintenanceCache.message,
        };
    }

    try {
        const res = await fetch(`${INTERNAL_ORIGIN}/api/site-status`, { cache: 'no-store' });
        if (!res.ok) return { enabled: false, until: '', message: '' };
        const body = (await res.json()) as { enabled?: boolean; until?: string; message?: string };
        const settings = {
            enabled: body.enabled === true,
            until: typeof body.until === 'string' ? body.until : '',
            message: typeof body.message === 'string' ? body.message : '',
        };
        maintenanceCache = { ...settings, fetchedAt: now };
        return settings;
    } catch {
        return { enabled: false, until: '', message: '' };
    }
}

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const response = NextResponse.next();
    const isAdminRoute = pathname.startsWith('/admin');
    const isApiRoute = pathname.startsWith('/api/');
    const isMaintenancePage = pathname === '/maintenance';

    // ============================================================
    // Security headers for ALL routes
    // ============================================================
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!isApiRoute && !pathname.startsWith('/_next')) {
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    }

    // ============================================================
    // Maintenance mode for storefront routes
    // - Admin/staff can still access storefront while logged in
    // ============================================================
    if (!isAdminRoute && !isApiRoute && !isMaintenancePage) {
        const maintenance = await getMaintenanceSettings();
        if (maintenance.enabled) {
            const token = extractAuthToken(request);
            const auth = token ? await getRoleFromToken(token) : null;
            const isAdminViewer =
                auth?.role === 'admin' || auth?.role === 'staff' || auth?.role === 'staff_pos';

            if (!isAdminViewer && !visitorWaitFinished(request)) {
                const maintenanceUrl = new URL('/maintenance', request.url);
                return NextResponse.redirect(maintenanceUrl);
            }
        }
    }

    // ============================================================
    // Admin route protection
    // ============================================================
    if (isAdminRoute) {
        // Security headers for admin
        response.headers.set('X-Robots-Tag', 'noindex, nofollow');
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');

        // Allow login page without auth
        if (pathname === '/admin/login') {
            return response;
        }

        const token = extractAuthToken(request);

        if (!token) {
            // No auth token found — redirect to login
            const loginUrl = new URL('/admin/login', request.url);
            loginUrl.searchParams.set('redirect', pathname);
            return NextResponse.redirect(loginUrl);
        }

        const auth = await getRoleFromToken(token);
        if (!auth) {
            const loginUrl = new URL('/admin/login', request.url);
            loginUrl.searchParams.set('redirect', pathname);
            loginUrl.searchParams.set('error', 'session_expired');
            return NextResponse.redirect(loginUrl);
        }
        if (auth.role !== 'admin' && auth.role !== 'staff' && auth.role !== 'staff_pos') {
            const loginUrl = new URL('/admin/login', request.url);
            loginUrl.searchParams.set('error', 'unauthorized');
            return NextResponse.redirect(loginUrl);
        }

        // Auth passed — set user info in headers for downstream use
        response.headers.set('x-user-id', auth.userId);
        response.headers.set('x-user-role', auth.role);
    }

    // ============================================================
    // API route security headers
    // ============================================================
    if (pathname.startsWith('/api/')) {
        response.headers.set('X-Content-Type-Options', 'nosniff');
        response.headers.set('Cache-Control', 'no-store');
    }

    return response;
}

export const config = {
    matcher: [
        // Storefront pages. The data API (/rest, /auth/v1, /storage) is
        // served from this app now and must never hit the maintenance redirect.
        '/((?!api|admin|rest/|auth/v1/|storage/|_next/static|_next/image|favicon.ico|.*\\..*).*)',
        '/admin/:path*',
        '/api/:path*',
    ],
};
