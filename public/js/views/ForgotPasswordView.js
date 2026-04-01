import { forgotPassword } from '../services/auth.js';

export class ForgotPasswordView {
  async render() {
    const el = document.createElement('div');
    el.className = 'main auth-page';
    el.innerHTML = `
      <div class="auth-container">
        <div class="auth-card">
          <div class="auth-card__eyebrow">Account Recovery</div>
          <h1 class="auth-card__title">Forgot Password</h1>
          <p class="auth-card__text">Enter your email and we'll send you a reset link.</p>

          <form class="auth-form" id="forgot-form" novalidate>
            <div class="form-group">
              <label class="form-label" for="forgot-email">Email Address</label>
              <input class="form-input" id="forgot-email" name="email" type="email"
                     autocomplete="email" required placeholder="you@example.com"/>
            </div>
            <p class="form-error" id="forgot-error" aria-live="polite"></p>
            <button class="btn btn--primary btn--full" type="submit" id="forgot-btn">Send Reset Link</button>
          </form>

          <div class="auth-success" id="forgot-success" hidden>
            <div class="auth-success__icon">✉</div>
            <p class="auth-success__text">
              If an account exists with that email, we've sent a password reset link.
              Check your inbox (and spam folder).
            </p>
          </div>

          <p class="auth-footer-links">
            Remember your password? <a href="#/login" class="signup-link" data-route="/login">Sign In</a>
          </p>
        </div>
      </div>
    `;

    el.querySelector('#forgot-form').addEventListener('submit', async e => {
      e.preventDefault();
      const form   = e.currentTarget;
      const errEl  = el.querySelector('#forgot-error');
      const btn    = el.querySelector('#forgot-btn');
      const email  = form.email.value.trim();

      errEl.textContent = '';
      if (!email) { errEl.textContent = 'Please enter your email.'; return; }

      btn.disabled = true;
      btn.textContent = 'Sending…';

      try {
        await forgotPassword(email);
        form.hidden = true;
        el.querySelector('#forgot-success').hidden = false;
      } catch {
        // Always show the same message to prevent email enumeration
        form.hidden = true;
        el.querySelector('#forgot-success').hidden = false;
      }
    });

    return el;
  }
}
