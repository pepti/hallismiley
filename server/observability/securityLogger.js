'use strict';

const logger = require('./logger');

// All security events share a 'security: true' field for easy log filtering
const sec = logger.child({ security: true });

const securityLogger = {
  /** A login attempt failed (wrong credentials). */
  loginFailed(ip, username) {
    sec.warn({ ip, username, event: 'login_failed' }, 'Failed login attempt');
  },

  /** An account was locked due to too many failed attempts. */
  accountLocked(ip, username, userId) {
    sec.warn({ ip, username, userId, event: 'account_locked' }, 'Account locked after failed attempts');
  },

  /** A rate limit (429) was triggered. */
  rateLimitHit(ip, path) {
    sec.warn({ ip, path, event: 'rate_limit_hit' }, 'Rate limit triggered');
  },

  /** A CSRF validation failed. */
  csrfFailure(ip, path, method) {
    sec.warn({ ip, path, method, event: 'csrf_failure' }, 'CSRF validation failure');
  },

  /** An authenticated request was made by a disabled account. */
  disabledAccountAccess(userId, username, ip) {
    sec.warn({ userId, username, ip, event: 'disabled_account_access' }, 'Disabled account access attempt');
  },

  /** A signup attempt. */
  signupAttempt(ip, username, result) {
    sec.info({ ip, username, result, event: 'signup_attempt' }, 'Signup attempt');
  },

  /** Successful login. */
  loginSuccess(ip, username, userId) {
    sec.info({ ip, username, userId, event: 'login_success' }, 'Successful login');
  },

  /** An admin performed an action. */
  adminAction(adminId, action, targetId, details) {
    sec.warn({ adminId, action, targetId, details, event: 'admin_action' }, 'Admin action performed');
  },

  /** A critical system alert. */
  alert(severity, title, details) {
    const level = severity === 'critical' ? 'error' : severity === 'warning' ? 'warn' : 'info';
    sec[level]({ severity, details, event: 'alert' }, title);
  },
};

module.exports = securityLogger;
