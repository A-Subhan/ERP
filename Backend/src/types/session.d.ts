/* ===========================================================================
 * Session augmentation — adds userId to Express sessions.
 * ==========================================================================*/
import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
  }
}

export {};
