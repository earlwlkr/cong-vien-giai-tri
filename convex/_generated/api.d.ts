/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as catalog from "../catalog.js";
import type * as chat from "../chat.js";
import type * as crons from "../crons.js";
import type * as fountain from "../fountain.js";
import type * as looks from "../looks.js";
import type * as players from "../players.js";
import type * as scores from "../scores.js";
import type * as shop from "../shop.js";
import type * as stats from "../stats.js";
import type * as time from "../time.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  catalog: typeof catalog;
  chat: typeof chat;
  crons: typeof crons;
  fountain: typeof fountain;
  looks: typeof looks;
  players: typeof players;
  scores: typeof scores;
  shop: typeof shop;
  stats: typeof stats;
  time: typeof time;
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

export declare const components: {};
