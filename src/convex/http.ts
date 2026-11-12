import { httpRouter } from 'convex/server';
import { authComponent, createAuth } from './auth';
import { oneClickUnsubscribe } from './emailUnsubscribe';

const http = httpRouter();
authComponent.registerRoutes(http, createAuth);

// CL-770: RFC 8058 one-click unsubscribe (List-Unsubscribe-Post) for application reminders.
http.route({ path: '/email/unsubscribe', method: 'POST', handler: oneClickUnsubscribe });

export default http;
