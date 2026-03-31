export class TermsView {
  async render() {
    const view = document.createElement('div');
    view.className = 'view';
    view.innerHTML = `
      <main class="main legal-page" id="main-content">
        <article class="legal-article">
          <header class="legal-header">
            <p class="admin-eyebrow">Legal</p>
            <h1 class="legal-title">Terms of Service</h1>
            <p class="legal-meta">Last updated: 28 March 2026</p>
          </header>

          <section class="legal-section">
            <h2>1. Acceptance of Terms</h2>
            <p>By accessing <strong>halliprojects.com</strong>, you agree to these Terms of Service. If you do not agree, please do not use this site.</p>
          </section>

          <section class="legal-section">
            <h2>2. Purpose of This Site</h2>
            <p>This website is a personal portfolio showcasing the carpentry and software engineering work of Halli. It is provided for informational and professional networking purposes only.</p>
          </section>

          <section class="legal-section">
            <h2>3. Intellectual Property</h2>
            <p>All content on this site — including project descriptions, images, code samples, and written text — is the intellectual property of Halli unless otherwise stated. You may not reproduce, distribute, or commercially exploit any content without prior written permission.</p>
            <p>You are welcome to share links to this portfolio and reference it for professional purposes (e.g., evaluating a contractor or collaborator).</p>
          </section>

          <section class="legal-section">
            <h2>4. Contact Form</h2>
            <p>The contact form is provided to facilitate genuine professional enquiries. Submission of spam, automated messages, or abusive content is prohibited and may be reported to your service provider.</p>
          </section>

          <section class="legal-section">
            <h2>5. Disclaimer of Warranties</h2>
            <p>This site is provided "as is" without warranties of any kind. While every effort is made to keep content accurate and up to date, no guarantee is made regarding the completeness or accuracy of any information presented.</p>
          </section>

          <section class="legal-section">
            <h2>6. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, Halli shall not be liable for any indirect, incidental, or consequential damages arising from your use of this site.</p>
          </section>

          <section class="legal-section">
            <h2>7. Governing Law</h2>
            <p>These terms are governed by the laws of Iceland. Any disputes shall be subject to the exclusive jurisdiction of the courts of Iceland.</p>
          </section>

          <section class="legal-section">
            <h2>8. Changes to These Terms</h2>
            <p>We reserve the right to update these terms at any time. Continued use of the site after changes constitutes acceptance of the revised terms.</p>
          </section>

          <footer class="legal-footer-nav">
            <a href="#/" class="btn btn--outline">Back to Home</a>
          </footer>
        </article>
      </main>
    `;
    return view;
  }
}
