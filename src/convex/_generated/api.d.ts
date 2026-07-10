/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as authEmail from "../authEmail.js";
import type * as booklet from "../booklet.js";
import type * as chat from "../chat.js";
import type * as chatModel from "../chatModel.js";
import type * as childAccounts from "../childAccounts.js";
import type * as childSignup from "../childSignup.js";
import type * as clubApplications from "../clubApplications.js";
import type * as clubScheduleSlots from "../clubScheduleSlots.js";
import type * as clubs from "../clubs.js";
import type * as cocModel from "../cocModel.js";
import type * as email_resend from "../email/resend.js";
import type * as email_templates from "../email/templates.js";
import type * as googleChat from "../googleChat.js";
import type * as http from "../http.js";
import type * as joinRequests from "../joinRequests.js";
import type * as legalContent from "../legalContent.js";
import type * as legalDocuments from "../legalDocuments.js";
import type * as media from "../media.js";
import type * as mediaModel from "../mediaModel.js";
import type * as mediaModeration from "../mediaModeration.js";
import type * as mediaMonitoring from "../mediaMonitoring.js";
import type * as mediaNode from "../mediaNode.js";
import type * as mediaPipeline from "../mediaPipeline.js";
import type * as mediaShared from "../mediaShared.js";
import type * as mediaStorage from "../mediaStorage.js";
import type * as monitoring from "../monitoring.js";
import type * as notifications from "../notifications.js";
import type * as notificationsModel from "../notificationsModel.js";
import type * as permissions from "../permissions.js";
import type * as pledges from "../pledges.js";
import type * as preferences from "../preferences.js";
import type * as privacyPolicy from "../privacyPolicy.js";
import type * as profiles from "../profiles.js";
import type * as projects from "../projects.js";
import type * as projectsModel from "../projectsModel.js";
import type * as rateLimiting from "../rateLimiting.js";
import type * as reports from "../reports.js";
import type * as roles from "../roles.js";
import type * as scheduleModel from "../scheduleModel.js";
import type * as sessions from "../sessions.js";
import type * as updates from "../updates.js";
import type * as usernameValidator from "../usernameValidator.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  authEmail: typeof authEmail;
  booklet: typeof booklet;
  chat: typeof chat;
  chatModel: typeof chatModel;
  childAccounts: typeof childAccounts;
  childSignup: typeof childSignup;
  clubApplications: typeof clubApplications;
  clubScheduleSlots: typeof clubScheduleSlots;
  clubs: typeof clubs;
  cocModel: typeof cocModel;
  "email/resend": typeof email_resend;
  "email/templates": typeof email_templates;
  googleChat: typeof googleChat;
  http: typeof http;
  joinRequests: typeof joinRequests;
  legalContent: typeof legalContent;
  legalDocuments: typeof legalDocuments;
  media: typeof media;
  mediaModel: typeof mediaModel;
  mediaModeration: typeof mediaModeration;
  mediaMonitoring: typeof mediaMonitoring;
  mediaNode: typeof mediaNode;
  mediaPipeline: typeof mediaPipeline;
  mediaShared: typeof mediaShared;
  mediaStorage: typeof mediaStorage;
  monitoring: typeof monitoring;
  notifications: typeof notifications;
  notificationsModel: typeof notificationsModel;
  permissions: typeof permissions;
  pledges: typeof pledges;
  preferences: typeof preferences;
  privacyPolicy: typeof privacyPolicy;
  profiles: typeof profiles;
  projects: typeof projects;
  projectsModel: typeof projectsModel;
  rateLimiting: typeof rateLimiting;
  reports: typeof reports;
  roles: typeof roles;
  scheduleModel: typeof scheduleModel;
  sessions: typeof sessions;
  updates: typeof updates;
  usernameValidator: typeof usernameValidator;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
