import { t, href } from '../i18n/i18n.js';

export class PrivacyView {
  async render() {
    const view = document.createElement('div');
    view.className = 'view';
    view.innerHTML = `
      <main class="main legal-page" id="main-content">
        <article class="legal-article">
          <header class="legal-header">
            <p class="admin-eyebrow">${t('legal.eyebrow')}</p>
            <h1 class="legal-title">${t('privacy.title')}</h1>
            <p class="legal-meta">Last updated: 28 March 2026</p>
          </header>

          <section class="legal-section">
            <h2>1. Who We Are</h2>
            <p>This website (<strong>halliprojects.is</strong>) is the personal portfolio of Halli, a carpenter and computer scientist. For privacy enquiries, contact: <span id="privacy-email-1"></span></p>
          </section>

          <section class="legal-section">
            <h2>2. What Data We Collect</h2>
            <h3>Contact Form</h3>
            <p>When you submit the contact form, we collect your name, email address, and message. This data is used solely to respond to your enquiry and is never sold or shared with third parties.</p>
            <h3>Authentication Cookies</h3>
            <p>If you are an authorised administrator, the site sets a secure, <code>httpOnly</code> cookie containing a hashed refresh token. This cookie is strictly necessary for maintaining your session and expires after 7 days.</p>
            <h3>Analytics</h3>
            <p>This site uses Google Analytics (GA4) to collect anonymised usage data such as page views, session duration, and general geographic region. No personally identifiable information is included. You can opt out using the <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener">Google Analytics Opt-out Browser Add-on</a>.</p>
          </section>

          <section class="legal-section">
            <h2>3. How We Use Your Data</h2>
            <ul>
              <li>To respond to contact form enquiries</li>
              <li>To maintain administrator sessions</li>
              <li>To understand how visitors use the site and improve the experience</li>
            </ul>
          </section>

          <section class="legal-section">
            <h2>4. Data Retention</h2>
            <p>Contact form submissions are retained for up to 12 months and then deleted. Session cookies expire after 7 days. Analytics data is retained according to Google Analytics' standard retention policy (26 months by default).</p>
          </section>

          <section class="legal-section">
            <h2>5. Your Rights</h2>
            <p>Under GDPR and applicable data protection law, you have the right to access, correct, or request deletion of any personal data we hold about you. To exercise these rights, contact <span id="privacy-email-2"></span>.</p>
          </section>

          <section class="legal-section">
            <h2>6. Third-Party Services</h2>
            <p>This site uses Google Analytics, operated by Google LLC. Please refer to <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google's Privacy Policy</a> for details on how they handle data.</p>
          </section>

          <section class="legal-section">
            <h2>7. Changes to This Policy</h2>
            <p>We may update this policy periodically. The date at the top of this page reflects the most recent revision.</p>
          </section>

          <footer class="legal-footer-nav">
            <a href="${href('/')}" class="btn btn--outline">${t('common.backToHome')}</a>
          </footer>
        </article>
      </main>
    `;
    // Obfuscate email — built from parts so scrapers can't harvest it from HTML source
    [view.querySelector('#privacy-email-1'), view.querySelector('#privacy-email-2')].forEach(el => {
      if (!el) return;
      const a = document.createElement('a');
      a.href = `mailto:${['halli', 'halliprojects.is'].join('@')}`;
      a.textContent = ['halli', 'halliprojects.is'].join('@');
      el.appendChild(a);
    });

    return view;
  }
}
