import { t, href, getLocale } from '../i18n/i18n.js';

// Privacy policy for the public business site (/personuvernd).
//
// DRAFT — Halli reviews before launch. Two things are deliberately factual
// rather than boilerplate: the lead form's field list (it must match what
// server/controllers/contactController.js actually accepts) and the analytics
// section (this site records first-party page views with no cookie and no
// third-party tag unless a GA id is configured — see public/js/consent.js).
// The kennitala lands once registration completes.

const COPY = {
  is: {
    updated: 'Síðast uppfært: 9. ágúst 2026',
    sections: [
      ['1. Ábyrgðaraðili', `
        <p>Þessi vefur (<strong>orangesmiley.is</strong>) er rekinn af Orange Smiley ehf.,
        Hafnarfirði, Íslandi (kennitala: í skráningu). Fyrirspurnir um persónuvernd:
        <span data-privacy-email></span></p>`],
      ['2. Hvaða upplýsingum við söfnum', `
        <h3>Fyrirspurnarform</h3>
        <p>Þegar þú sendir fyrirspurn söfnum við nafni, netfangi og skilaboðum, og —
        ef þú kýst að gefa þau upp — nafni fyrirtækis, símanúmeri og því kerfi sem þú
        notar í dag. Þessar upplýsingar eru einungis notaðar til að svara erindinu og
        eru hvorki seldar né deilt með þriðja aðila.</p>
        <h3>Innskráning</h3>
        <p>Ef þú ert með aðgang setur vefurinn öruggar <code>httpOnly</code> vafrakökur
        fyrir setuna þína. Þær eru nauðsynlegar fyrir innskráninguna sjálfa.</p>
        <h3>Vefmælingar</h3>
        <p>Við teljum heimsóknir á eigin vef án vafrakaka og án auðkennanlegra
        upplýsinga: slóð síðunnar, tungumál, tegund tækis og vísandi vefsvæði. Engin
        IP-tala og enginn vafrastrengur er vistaður.</p>`],
      ['3. Hvernig upplýsingarnar eru notaðar', `
        <ul>
          <li>Til að svara fyrirspurnum og undirbúa tilboð</li>
          <li>Til að viðhalda innskráðum setum</li>
          <li>Til að skilja notkun vefsins og bæta hann</li>
        </ul>`],
      ['4. Varðveislutími', `
        <p>Fyrirspurnir eru varðveittar í allt að 24 mánuði og síðan eytt. Setuvafrakökur
        renna út eftir 7 daga. Bókhaldsgögn viðskiptavina eru varðveitt í 7 ár eins og
        lög um bókhald (nr. 145/1994) krefjast.</p>`],
      ['5. Réttindi þín', `
        <p>Samkvæmt lögum nr. 90/2018 um persónuvernd og GDPR átt þú rétt á að fá aðgang
        að, leiðrétta eða láta eyða persónuupplýsingum um þig. Hafðu samband við
        <span data-privacy-email></span> til að nýta þessi réttindi. Þú getur einnig
        beint kvörtun til Persónuverndar (personuvernd.is).</p>`],
      ['6. Vinnsluaðilar og staðsetning gagna', `
        <p>Vefurinn og gagnagrunnurinn eru hýst hjá Microsoft Azure á svæðum innan
        Evrópska efnahagssvæðisins. Tölvupóstur er sendur um Resend. Þegar Orange Smiley
        rekur kerfi fyrir viðskiptavin erum við vinnsluaðili og gerum sérstakan
        vinnslusamning við hann.</p>`],
      ['7. Breytingar á stefnunni', `
        <p>Stefnan kann að verða uppfærð. Dagsetningin efst á síðunni sýnir hvenær hún
        var síðast endurskoðuð.</p>`],
    ],
  },
  en: {
    updated: 'Last updated: 9 August 2026',
    sections: [
      ['1. Who We Are', `
        <p>This website (<strong>orangesmiley.is</strong>) is operated by Orange Smiley ehf.,
        Hafnarfjörður, Iceland (company registration: pending). For privacy enquiries,
        contact: <span data-privacy-email></span></p>`],
      ['2. What Data We Collect', `
        <h3>Inquiry form</h3>
        <p>When you submit an inquiry we collect your name, email address and message, plus
        — if you choose to provide them — your company name, phone number and the system you
        use today. This is used solely to respond to your enquiry and is never sold or
        shared with third parties.</p>
        <h3>Authentication</h3>
        <p>If you hold an account, the site sets secure <code>httpOnly</code> session
        cookies. These are strictly necessary for signing in.</p>
        <h3>Analytics</h3>
        <p>We count visits on our own server without cookies and without identifying
        information: the page path, language, device type and referring site. No IP address
        and no user-agent string is stored.</p>`],
      ['3. How We Use Your Data', `
        <ul>
          <li>To respond to enquiries and prepare proposals</li>
          <li>To maintain signed-in sessions</li>
          <li>To understand how the site is used and improve it</li>
        </ul>`],
      ['4. Data Retention', `
        <p>Inquiries are retained for up to 24 months and then deleted. Session cookies
        expire after 7 days. Customer accounting records are retained for 7 years as
        required by Icelandic bookkeeping law (no. 145/1994).</p>`],
      ['5. Your Rights', `
        <p>Under Icelandic act no. 90/2018 and the GDPR you have the right to access,
        correct or request deletion of personal data we hold about you. Contact
        <span data-privacy-email></span> to exercise these rights. You may also lodge a
        complaint with the Icelandic Data Protection Authority (personuvernd.is).</p>`],
      ['6. Processors and Data Location', `
        <p>The site and its database are hosted on Microsoft Azure in European Economic Area
        regions. Email is delivered via Resend. Where Orange Smiley operates a system on
        behalf of a customer we act as a data processor under a separate processing
        agreement.</p>`],
      ['7. Changes to This Policy', `
        <p>This policy may be updated. The date at the top of the page reflects the most
        recent revision.</p>`],
    ],
  },
};

export class PrivacyView {
  async render() {
    const copy = COPY[getLocale()] || COPY.is;
    const view = document.createElement('div');
    view.className = 'view';
    view.innerHTML = `
      <main class="main legal-page" id="main-content">
        <article class="legal-article">
          <header class="legal-header">
            <p class="admin-eyebrow">${t('legal.eyebrow')}</p>
            <h1 class="legal-title">${t('privacy.title')}</h1>
            <p class="legal-meta">${copy.updated}</p>
          </header>

          ${copy.sections.map(([heading, body]) => `
          <section class="legal-section">
            <h2>${heading}</h2>
            ${body}
          </section>`).join('')}

          <footer class="legal-footer-nav">
            <a href="${href('/')}" class="btn btn--outline">${t('common.backToHome')}</a>
          </footer>
        </article>
      </main>
    `;

    // Obfuscate the address — built from parts so scrapers can't harvest it
    // from the HTML source.
    view.querySelectorAll('[data-privacy-email]').forEach(el => {
      const a = document.createElement('a');
      const addr = ['info', 'orangesmiley.is'].join('@');
      a.href = `mailto:${addr}`;
      a.textContent = addr;
      el.appendChild(a);
    });

    return view;
  }
}
