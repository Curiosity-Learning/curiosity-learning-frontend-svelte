import { httpRouter } from 'convex/server';
import type { HttpRouter } from 'convex/server';
import { corsRouter } from 'convex-helpers/server/cors';
import { authComponent, createAuth } from './auth';
import { oneClickUnsubscribe } from './emailUnsubscribe';
import { nativeAppCorsOrigins } from './nativeAppAuth';

const http = httpRouter();

// CL-819 spike: CORS on /api/auth/* for the Capacitor WebView origins only. registerRoutes'
// own `cors` option would allow every trustedOrigins entry (web dev ports, ngrok, the admin app);
// instead its routes are registered through a CORS router whose allowlist is just the two native
// origins, and only while NATIVE_APP_AUTH=true (read per request). Any other Origin gets no
// Access-Control-Allow-Origin, so a browser on it cannot read the response. Without credentials:
// the native client sends the session as a Better-Auth-Cookie header with credentials: 'omit'.
const nativeAppCors = corsRouter(http, {
	allowedOrigins: async () => nativeAppCorsOrigins(),
	allowedHeaders: ['Content-Type', 'Better-Auth-Cookie', 'Authorization'],
	exposedHeaders: ['Set-Better-Auth-Cookie'],
	allowCredentials: false,
	debug: false
});
// registerRoutes (without its own cors option) only calls lookup() and route().
const authRoutes = {
	lookup: http.lookup.bind(http),
	route: nativeAppCors.route
} as unknown as HttpRouter;
authComponent.registerRoutes(authRoutes, createAuth);

// CL-770: RFC 8058 one-click unsubscribe (List-Unsubscribe-Post) for application reminders.
http.route({ path: '/email/unsubscribe', method: 'POST', handler: oneClickUnsubscribe });

export default http;
