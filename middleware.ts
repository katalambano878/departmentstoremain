import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAINTENANCE_CACHE_TTL_MS = 30 * 1000;
let maintenanceCache: {
    enabled: boolean;
    until: string;
    message: string;
    fetchedAt: number;
} | null = null;

function parseSettingValue(raw: string): any {
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

function extractAuthToken(request: NextRequest): string | undefined {
    let token: string | undefined;

    // 1) Explicit cookie set after admin login
    token = request.cookies.get('sb-access-token')?.value;

    // 2) Supabase project cookie format
    if (!token) {
        const projectRef = supabaseUrl?.split('//')[1]?.split('.')[0];
        token = request.cookies.get(`sb-${projectRef}-auth-token`)?.value;
    }

    // 3) Other Supabase auth cookie formats
    if (!token) {
        for (const [name, cookie] of request.cookies) {
            if (name.startsWith('sb-') && (name.endsWith('-auth-token') || name.includes('auth'))) {
                try {
                    const parsed = JSON.parse(cookie.value);
                    if (Array.isArray(parsed) && parsed[0]) {
                        token = parsed[0];
                    } else if (typeof parsed === 'object' && parsed.access_token) {
                        token = parsed.access_token;
                    } else if (typeof parsed === 'string') {
                        token = parsed;
                    }
                } catch {
                    token = cookie.value;
                }
                if (token) break;
            }
        }
    }

    return token;
}

async function getRoleFromToken(token: string): Promise<{ userId: string; role: string } | null> {
    if (!supabaseServiceKey) return null;
    try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        });

        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) return null;

        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (!profile) return null;
        return { userId: user.id, role: profile.role };
    } catch {
        return null;
    }
}

async function getMaintenanceSettings(): Promise<{ enabled: boolean; until: string; message: string }> {
    if (!supabaseServiceKey) {
        return { enabled: false, until: '', message: '' };
    }

    const now = Date.now();
    if (maintenanceCache && now - maintenanceCache.fetchedAt < MAINTENANCE_CACHE_TTL_MS) {
        return {
            enabled: maintenanceCache.enabled,
            until: maintenanceCache.until,
            message: maintenanceCache.message,
        };
    }

    try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        });
        const { data } = await supabase
            .from('site_settings')
            .select('key, value')
            .in('key', ['maintenance_mode', 'maintenance_until', 'maintenance_message']);

        const map: Record<string, any> = {};
        (data || []).forEach((row: any) => {
            map[row.key] = parseSettingValue(row.value);
        });

        const until = typeof map.maintenance_until === 'string' ? map.maintenance_until : '';
        const untilMs = until ? new Date(until).getTime() : NaN;
        const stillRunning = !until || Number.isNaN(untilMs) || untilMs > Date.now();
        const settings = {
            enabled: (map.maintenance_mode === true || map.maintenance_mode === 'true') && stillRunning,
            until,
            message: typeof map.maintenance_message === 'string' ? map.maintenance_message : '',
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

            if (!isAdminViewer) {
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
        '/((?!api|admin|_next/static|_next/image|favicon.ico|.*\\..*).*)',
        '/admin/:path*',
        '/api/:path*',
    ],
};
