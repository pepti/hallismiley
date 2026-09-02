import { t, href, getLocale } from '../i18n/i18n.js';

// Terms of service for the public company site (/terms).
//
// DRAFT — Halli reviews before launch. Rewritten 2026-09-01: the previous
// version was English-only and described "a personal portfolio showcasing the
// carpentry and software engineering work of Halli", with the IP vesting in
// Halli personally. This site is Orange Smiley ehf.'s company site, it is in
// the sitemap, and Icelandic is the default locale — so the copy follows the
// PrivacyView pattern: drafted in Icelandic, mirrored in English, and the
// legal entity is the company.
//
// These terms cover THIS WEBSITE only. Subscribing to Rekstrarkerfið is a
// service agreement between the customer and the company, and does not live
// on a marketing page. Company identity below is live: kt. 470826-1500
// (2026-08-11), VSK-nr. 162561 (registered 2026-08-12) — keep it in step
// with company/COMPANY-LOG.md.

const COPY = {
  is: {
    updated: 'Síðast uppfært: 1. september 2026',
    sections: [
      ['1. Gildissvið', `
        <p>Þessi vefur (<strong>orangesmiley.is</strong>) er rekinn af Orange Smiley ehf.,
        Hafnarfirði, Íslandi (kt. 470826-1500, VSK-nr. 162561). Með því að nota vefinn samþykkir þú
        þessa skilmála. Ef þú samþykkir þá ekki, biðjum við þig að nota ekki vefinn.</p>`],
      ['2. Hvað vefurinn er', `
        <p>Vefurinn kynnir Orange Smiley ehf. og vörur fyrirtækisins, þar á meðal
        Rekstrarkerfið. Efni hans er til upplýsingar og er hvorki bindandi tilboð né
        samningur.</p>
        <p>Verð sem birt eru á vefnum eru til viðmiðunar og geta breyst. Áskrift að
        Rekstrarkerfinu byggir á sérstökum þjónustusamningi milli fyrirtækisins og
        viðskiptavinar — þessir skilmálar ná ekki yfir hann.</p>`],
      ['3. Hugverkaréttur', `
        <p>Allt efni á vefnum — texti, myndir, hönnun, merki og kóði — er eign
        Orange Smiley ehf. nema annað sé tekið fram. Efnið má ekki afrita, dreifa eða
        nýta í viðskiptalegum tilgangi án skriflegs leyfis.</p>
        <p>Þér er velkomið að deila tenglum á vefinn og vísa í hann.</p>
        <p>Ljósmyndir af íslenskri náttúru á vefnum eru birtar með leyfi höfunda þeirra;
        upplýsingar um hverja mynd eru í <a href="/assets/iceland/CREDITS.md">myndaskránni</a>.</p>`],
      ['4. Fyrirspurnarform', `
        <p>Fyrirspurnarformið er ætlað raunverulegum erindum. Ruslpóstur, sjálfvirk
        skilaboð og móðgandi efni eru óheimil og kunna að vera tilkynnt til
        þjónustuaðila sendanda.</p>
        <p>Um meðferð persónuupplýsinga fer samkvæmt
        <a href="/personuvernd">persónuverndarstefnu</a> okkar.</p>`],
      ['5. Fyrirvari', `
        <p>Vefurinn er veittur „eins og hann er“ án ábyrgðar af nokkru tagi. Þótt lögð sé
        áhersla á að efnið sé rétt og uppfært er ekki ábyrgst að það sé tæmandi eða
        villulaust.</p>`],
      ['6. Takmörkun ábyrgðar', `
        <p>Að því marki sem lög leyfa ber Orange Smiley ehf. ekki ábyrgð á óbeinu tjóni,
        afleiddu tjóni eða tilfallandi tjóni sem rekja má til notkunar vefsins.</p>`],
      ['7. Lög og varnarþing', `
        <p>Um skilmálana gilda íslensk lög. Ágreiningur sem kann að rísa verður rekinn
        fyrir Héraðsdómi Reykjaness.</p>`],
      ['8. Breytingar', `
        <p>Við áskiljum okkur rétt til að uppfæra þessa skilmála. Áframhaldandi notkun
        vefsins eftir breytingar telst samþykki á uppfærðum skilmálum. Dagsetning
        síðustu uppfærslu stendur efst á síðunni.</p>`],
    ],
  },
  en: {
    updated: 'Last updated: 1 September 2026',
    sections: [
      ['1. Scope', `
        <p>This website (<strong>orangesmiley.is</strong>) is operated by Orange Smiley ehf.,
        Hafnarfjörður, Iceland (reg. no. 470826-1500, VAT no. 162561). By using the site you accept
        these terms. If you do not accept them, please do not use the site.</p>`],
      ['2. What this site is', `
        <p>The site presents Orange Smiley ehf. and its products, including Rekstrarkerfið.
        Its content is provided for information and is neither a binding offer nor a
        contract.</p>
        <p>Prices shown on the site are indicative and may change. A subscription to
        Rekstrarkerfið is governed by a separate service agreement between the company and
        the customer, which these terms do not cover.</p>`],
      ['3. Intellectual property', `
        <p>All content on this site — text, images, design, marks and code — is the property
        of Orange Smiley ehf. unless otherwise stated. It may not be reproduced, distributed
        or commercially exploited without written permission.</p>
        <p>You are welcome to link to the site and to reference it.</p>
        <p>Photographs of Icelandic landscapes on this site are published under their
        authors' licences; per-image details are in the
        <a href="/assets/iceland/CREDITS.md">photo credits</a>.</p>`],
      ['4. Contact form', `
        <p>The contact form is provided for genuine enquiries. Spam, automated messages and
        abusive content are prohibited and may be reported to the sender's service
        provider.</p>
        <p>Personal data is handled according to our
        <a href="/personuvernd">privacy policy</a>.</p>`],
      ['5. Disclaimer', `
        <p>The site is provided "as is" without warranties of any kind. While every effort is
        made to keep the content accurate and current, it is not guaranteed to be complete
        or free of error.</p>`],
      ['6. Limitation of liability', `
        <p>To the maximum extent permitted by law, Orange Smiley ehf. is not liable for any
        indirect, consequential or incidental damages arising from use of the site.</p>`],
      ['7. Governing law', `
        <p>These terms are governed by Icelandic law. Any dispute shall be heard by
        Héraðsdómur Reykjaness.</p>`],
      ['8. Changes', `
        <p>We may update these terms. Continued use of the site after a change constitutes
        acceptance of the revised terms. The date of the last update appears at the top of
        this page.</p>`],
    ],
  },
};

export class TermsView {
  async render() {
    const copy = COPY[getLocale()] || COPY.is;
    const view = document.createElement('div');
    view.className = 'view';
    view.innerHTML = `
      <main class="main legal-page" id="main-content">
        <article class="legal-article">
          <header class="legal-header">
            <p class="admin-eyebrow">${t('legal.eyebrow')}</p>
            <h1 class="legal-title">${t('terms.title')}</h1>
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
    return view;
  }
}
