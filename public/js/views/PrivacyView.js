import { t, href, getLocale } from '../i18n/i18n.js';
import { mountSceneHeader } from '../scenes/sceneHeader.js';
import { siteHost } from '../utils/identity.js';
import { reopenCookieChoice } from '../services/cookieConsent.js';

// Privacy policy for the public business site (/personuvernd).
//
// DRAFT — Halli reviews before launch. Icelandic is canonical; the English
// mirrors it.
//
// EVERY factual claim here was read off the code on 2026-09-02, not assumed.
// If you change any of these, change the policy in the same commit:
//   - lead form fields ............ server/controllers/contactController.js
//     Since 2026-09-07 the enquiry IS persisted (migration 097 `leads`,
//     server/models/Lead.js) alongside the notification email, read by
//     admins + the sales role at /admin/leads, and pruned after
//     LEAD_RETENTION_DAYS (default 730 — the "24 months" in §6;
//     server/services/leadsCleanup.js). Change that number and §6 together.
//   - page_views columns .......... server/config/schema.js (~1400)
//   - visitor_token derivation .... server/services/analyticsSalt.js
//     (SHA-256 of a DAILY salt + ip + user-agent; neither input is stored)
//   - error/monitoring log ........ server/models/EventLog.js + eventLogCleanup.js
//     (stores user_agent and, when signed in, username; 90-day prune)
//   - session lifetime ............ server/auth/lucia.js — no sessionExpiresIn
//     is set, so Lucia v3's default of 30 days applies (node_modules/lucia
//     core.js: `?? new TimeSpan(30, "d")`). It is NOT 7 days.
//   - GA is consent-gated and dark until GA_MEASUREMENT_ID is set (consent.js)
//   - the EN→IS translator calls Anthropic, but only on ADMIN-saved site copy
//     and only when TRANSLATE_ENABLED + ANTHROPIC_API_KEY are set
//     (server/services/translator.js). No visitor data goes to it.
// Company identity is live: kt. 470826-1500 (2026-08-11), VSK-nr. 162561
// (registered 2026-08-12). Keep it in step with company/COMPANY-LOG.md.
//
// KNOWN GAP, deliberately stated rather than papered over: page_views has no
// prune job, so §6 says the aggregate is kept indefinitely. If Halli wants a
// retention window there, add the job first and then shorten §6.

const COPY = {
  is: {
    updated: 'Síðast uppfært: 25. september 2026',
    sections: [
      ['1. Ábyrgðaraðili', `
        <p>Þessi vefur (<strong>{siteHost}</strong>) er rekinn af Orange Smiley ehf.,
        Arnarhrauni 4, 220 Hafnarfirði (kt. 470826-1500, VSK-nr. 162561). Fyrirspurnir um
        persónuvernd: <span data-privacy-email></span></p>`],
      ['2. Tvö ólík hlutverk — lestu þetta fyrst', `
        <p>Orange Smiley bæði <em>rekur þennan vef</em> og <em>smíðar og hýsir kerfi fyrir
        önnur fyrirtæki</em>. Persónuverndarlega eru þetta tveir aðskildir hlutir og það
        skiptir máli hvor á við um þig:</p>
        <ul>
          <li><strong>Þessi vefur.</strong> Hér erum við <strong>ábyrgðaraðili</strong> og
          þessi stefna gildir að fullu.</li>
          <li><strong>Kerfi viðskiptavina okkar</strong> — t.d. Rekstrarkerfið eða vefverslun
          sem við rekum fyrir fyrirtæki. Þar erum við <strong>vinnsluaðili</strong>: gögnin
          tilheyra viðskiptavininum, hann ákveður hvernig þau eru notuð, og við vinnum þau
          eingöngu samkvæmt fyrirmælum hans og skriflegum vinnslusamningi (28. gr. GDPR).
          <strong>Þessi stefna gildir ekki um þau gögn</strong> — leitaðu til fyrirtækisins
          sem þú átt í viðskiptum við, og það beinir erindinu til okkar ef þarf.</li>
        </ul>`],
      ['3. Hvaða upplýsingum við söfnum á þessum vef', `
        <h3>Fyrirspurnarform</h3>
        <p>Við biðjum um <strong>nafn, netfang og skilaboð</strong>. Þú mátt einnig gefa upp
        <strong>fyrirtæki, símanúmer og hvaða kerfi þú notar í dag</strong> — það er valfrjálst
        og fyrirspurnin er aldrei afgreidd verr þótt reitirnir séu auðir.</p>
        <p>Fyrirspurnin er <strong>vistuð í gagnagrunni vefsins</strong> — nafn, netfang,
        fyrirtæki, sími, kerfið sem þú notar í dag og skilaboðin — og send um leið sem
        tölvupóstur í fyrirtækjapósthólfið okkar. Í kerfinu sjá hana aðeins stjórnendur
        fyrirtækisins og sölufólk okkar, og hún er eingöngu notuð til að svara þér og fylgja
        erindinu eftir. Á sama tíma skráum við eina talningarfærslu sem inniheldur
        <em>aðeins</em> hvaða kerfi var valið — ekkert nafn, netfang eða skilaboð.</p>
        <h3>Aðgangur og innskráning</h3>
        <p>Ef þú ert með aðgang setur vefurinn örugga <code>httpOnly</code> vafraköku fyrir
        setuna. Hún er nauðsynleg fyrir innskráninguna sjálfa og er ekki notuð til mælinga.</p>
        <h3>Vefmælingar</h3>
        <p>Við teljum heimsóknir á okkar eigin þjóni, án mælingavafraköku. Skráð er: slóð
        síðunnar, lén vísandi vefsvæðis, tegund tækis, vafra og stýrikerfis, og tungumál.</p>
        <p>Til að geta talið <em>einstaka</em> gesti búum við til auðkennisstreng með SHA-256
        út frá IP-tölu, vafrastreng og leynilykli sem skiptir um gildi á hverjum sólarhring.
        <strong>Hvorki IP-talan né vafrastrengurinn eru vistuð</strong>, strenginn er ekki
        hægt að rekja til baka, og hann verður nýr á hverjum degi — svo sami gestur er ekki
        rakinn milli daga.</p>
        <h3>Villuskráning og rekstrareftirlit</h3>
        <p>Þegar villa kemur upp skráum við hana svo hægt sé að laga hana. Sú færsla getur
        innihaldið villuboðin, slóðina, HTTP-stöðu, <strong>vafrastreng</strong>, auðkenni
        beiðninnar og — ef þú ert innskráð/ur — <strong>notandanafnið þitt</strong>. Þetta er
        aðskilið frá vefmælingunum hér að ofan og er varðveitt skemur (sjá 6. kafla).</p>
        <h3>Vafrakökur</h3>
        <p>Vefurinn notar tvenns konar vafrakökur: <strong>nauðsynlegar</strong> (innskráning,
        tungumálaval, öryggis-token gegn fölsuðum beiðnum) sem eru alltaf virkar, og
        <strong>mælingavafrakökur þriðja aðila</strong> sem eru <em>aðeins</em> settar ef þú
        samþykkir þær í borðanum sem birtist við fyrstu heimsókn. Hafnir þú þeim eru þær
        aldrei settar; talningin okkar hér að ofan heldur áfram og hún notar enga vafraköku.</p>`],
      ['4. Lagagrundvöllur', `
        <p>Vinnslan byggir á eftirfarandi heimildum í 6. gr. GDPR (9. gr. laga nr. 90/2018):</p>
        <ul>
          <li><strong>Lögmætir hagsmunir</strong> (6. gr. 1. mgr. f): vefmælingar á eigin þjóni,
          villuskráning og varnir gegn misnotkun. Hagsmunirnir eru að reka öruggan vef sem
          virkar — og vinnslan er hönnuð til að vera eins lítil og hægt er.</li>
          <li><strong>Samþykki</strong> (6. gr. 1. mgr. a): mælingavafrakökur þriðja aðila. Þú
          getur dregið samþykkið til baka hvenær sem er með því að hreinsa vefkökur síðunnar.</li>
          <li><strong>Samningur eða ráðstafanir að beiðni þinni</strong> (6. gr. 1. mgr. b):
          að svara fyrirspurninni þinni, gera tilboð og reka aðganginn þinn.</li>
          <li><strong>Lagaskylda</strong> (6. gr. 1. mgr. c): bókhaldsgögn.</li>
        </ul>`],
      ['5. Hvernig upplýsingarnar eru notaðar', `
        <ul>
          <li>Til að svara fyrirspurnum, undirbúa tilboð og halda utan um samskipti við þig</li>
          <li>Til að viðhalda innskráðum setum og verja aðganga</li>
          <li>Til að sjá hvaða síður eru notaðar og bæta vefinn</li>
          <li>Til að finna og laga villur í rekstri</li>
        </ul>
        <p>Við <strong>seljum aldrei</strong> persónuupplýsingar, notum þær ekki í
        auglýsingamiðun og deilum þeim ekki með þriðja aðila nema því sem talið er upp í
        7. kafla.</p>`],
      ['6. Varðveislutími', `
        <ul>
          <li><strong>Fyrirspurnir</strong> — geymdar í kerfinu í <strong>24 mánuði</strong>
          frá móttöku og eytt sjálfkrafa eftir það (keyrt daglega). Afritið í
          fyrirtækjapósthólfinu lifir eins og önnur samskipti. Biddu okkur um eyðingu hvenær
          sem er og við verðum við því.</li>
          <li><strong>Setuvafrakökur</strong> — renna út eftir <strong>30 daga</strong>, og
          útrunnum setum er eytt sjálfkrafa daglega.</li>
          <li><strong>Villuskráning</strong> — <strong>90 dagar</strong>, síðan er henni eytt
          sjálfkrafa.</li>
          <li><strong>Vefmælingar</strong> — talningin er varðveitt ótímabundið sem tölfræði.
          Auðkennisstrengurinn úreldist af sjálfu sér um leið og leynilykill dagsins skiptir um
          gildi, svo eldri færslur eru hrein tölfræði.</li>
          <li><strong>Bókhaldsgögn</strong> — <strong>7 ár</strong>, eins og lög nr. 145/1994
          um bókhald krefjast.</li>
        </ul>`],
      ['7. Vinnsluaðilar og staðsetning gagna', `
        <ul>
          <li><strong>Microsoft Azure</strong> — hýsing á vefnum og gagnagrunninum, í gagnaveri
          Microsoft í Svíþjóð, innan Evrópska efnahagssvæðisins.</li>
          <li><strong>Resend</strong> — afhending tölvupósts (m.a. fyrirspurna úr forminu).
          Bandarískt félag; flutningur byggir á stöðluðum samningsákvæðum ESB.</li>
          <li><strong>Google Workspace</strong> (Google Ireland Ltd.) — fyrirtækjapósthólfið
          sem fyrirspurnin þín lendir í.</li>
          <li><strong>Stripe</strong> — <em>ef</em> greiðsla fer fram. Kortaupplýsingar fara
          beint til Stripe og eru aldrei vistaðar hjá okkur.</li>
          <li><strong>Sentry</strong> — villugreining, þegar hún er virkjuð.</li>
          <li><strong>YouTube</strong> (youtube-nocookie.com) — aðeins ef þú spilar innfellt
          myndband. Ekkert er sótt þangað fyrr en þú spilar.</li>
        </ul>
        <p>Þegar Orange Smiley rekur kerfi fyrir viðskiptavin (2. kafli) gilda undirvinnsluaðilar
        þess kerfis samkvæmt vinnslusamningnum við viðkomandi fyrirtæki.</p>`],
      ['8. Gervigreind', `
        <p>Orange Smiley notar gervigreind við smíði og rekstur kerfa. Tvennt er rétt að taka
        skýrt fram:</p>
        <ul>
          <li>Fyrirspurnin þín, netfangið þitt og önnur persónuleg gögn af þessum vef eru
          <strong>ekki send í gervigreindarþjónustu</strong> og eru <strong>ekki notuð til að
          þjálfa gervigreindarlíkön</strong>.</li>
          <li>Efni sem <em>starfsfólk okkar skrifar</em> á vefinn kann að vera þýtt sjálfvirkt
          milli tungumála með þjónustu Anthropic. Það á við um texta síðunnar, ekki um gögn
          gesta.</li>
        </ul>`],
      ['9. Öryggi', `
        <p>Öll umferð fer um TLS. Lykilorð eru geymd sem saltaðar tætur, aldrei í læsilegu
        formi. Tveggja þátta auðkenning stendur til boða á stjórnendaaðgöngum. Aðgangsstýring
        er hlutverkabundin og aðgangur er takmarkaður við þá sem þurfa hann starfs síns vegna.
        Leyndarmál eru hreinsuð úr atburðaskrám áður en þær eru vistaðar. Ekkert kerfi er
        fullkomlega öruggt, en komi upp öryggisbrestur sem líklegur er til að valda áhættu
        fyrir þig tilkynnum við það í samræmi við 33. og 34. gr. GDPR.</p>`],
      ['10. Réttindi þín', `
        <p>Samkvæmt lögum nr. 90/2018 um persónuvernd og GDPR átt þú rétt á að fá
        <strong>aðgang</strong> að upplýsingum um þig, láta <strong>leiðrétta</strong> þær,
        láta <strong>eyða</strong> þeim, <strong>takmarka</strong> vinnslu þeirra,
        <strong>andmæla</strong> vinnslu sem byggir á lögmætum hagsmunum, og fá gögnin þín
        <strong>flutt</strong> á tölvutæku formi.</p>
        <p>Sendu erindi á <span data-privacy-email></span> og við svörum innan mánaðar. Þjónustan
        er gjaldfrjáls. Ef þú ert ósátt/ur við úrlausnina getur þú beint kvörtun til
        <strong>Persónuverndar</strong> (personuvernd.is), Laugavegi 166, 105 Reykjavík.</p>
        <p>Varða gögnin kerfi sem við rekum fyrir annað fyrirtæki (2. kafli) beinum við erindinu
        til þess fyrirtækis, sem er ábyrgðaraðili þeirra gagna.</p>`],
      ['11. Breytingar á stefnunni', `
        <p>Stefnan kann að verða uppfærð. Dagsetningin efst á síðunni sýnir hvenær hún var
        síðast endurskoðuð. Verði breytingar verulegar látum við vita á vefnum.</p>`],
    ],
  },
  en: {
    updated: 'Last updated: 25 September 2026',
    sections: [
      ['1. Who We Are', `
        <p>This website (<strong>{siteHost}</strong>) is operated by Orange Smiley ehf.,
        Arnarhraun 4, 220 Hafnarfjörður, Iceland (reg. no. 470826-1500, VAT no. 162561). For
        privacy enquiries: <span data-privacy-email></span></p>`],
      ['2. Two Different Roles — Read This First', `
        <p>Orange Smiley both <em>runs this website</em> and <em>builds and hosts systems for
        other companies</em>. In data-protection terms those are two separate things, and it
        matters which one applies to you:</p>
        <ul>
          <li><strong>This website.</strong> Here we are the <strong>controller</strong>, and
          this policy applies in full.</li>
          <li><strong>Our customers' systems</strong> — for example Rekstrarkerfið, or a
          web shop we operate for a company. There we are a <strong>processor</strong>: the
          data belongs to that customer, they decide how it is used, and we process it only on
          their instructions under a written data processing agreement (GDPR Art. 28).
          <strong>This policy does not govern that data</strong> — contact the company you deal
          with, and they will pass the request to us if needed.</li>
        </ul>`],
      ['3. What We Collect On This Site', `
        <h3>Enquiry form</h3>
        <p>We ask for your <strong>name, email address and message</strong>. You may also give
        your <strong>company, phone number and the system you use today</strong> — those are
        optional, and your enquiry is never handled any worse for leaving them blank.</p>
        <p>The enquiry is <strong>stored in the website's database</strong> — name, email
        address, company, phone, the system you use today and the message — and sent at the
        same time as email to our company mailbox. Inside the system only the company's
        administrators and our sales staff can see it, and it is used solely to answer you and
        follow the enquiry up. At the same time we record a single counting event containing
        <em>only</em> which system was selected — no name, email address or message.</p>
        <h3>Accounts and sign-in</h3>
        <p>If you hold an account, the site sets a secure <code>httpOnly</code> session cookie.
        It is strictly necessary for signing in and is not used for analytics.</p>
        <h3>Analytics</h3>
        <p>We count visits on our own server, with no analytics cookie. We record: the page
        path, the referring site's domain, device, browser and operating-system type, and
        language.</p>
        <p>To count <em>unique</em> visitors we derive an identifier with SHA-256 from the IP
        address, the user-agent string and a secret key that changes every 24 hours.
        <strong>Neither the IP address nor the user-agent string is stored</strong>, the
        identifier cannot be reversed, and it becomes a new value each day — so the same
        visitor is not tracked across days.</p>
        <h3>Error and operational logging</h3>
        <p>When an error occurs we record it so it can be fixed. That entry may contain the
        error message, the path, the HTTP status, the <strong>user-agent string</strong>, a
        request identifier and — if you are signed in — <strong>your username</strong>. This is
        separate from the analytics above and is kept for a shorter time (see section 6).</p>
        <h3>Cookies</h3>
        <p>The site uses two kinds of cookie: <strong>strictly necessary</strong> ones (sign-in,
        language choice, anti-forgery tokens), which are always active, and
        <strong>third-party analytics cookies</strong>, which are set <em>only</em> if you
        accept them in the banner shown on your first visit. If you decline, they are never
        set; our own counting described above continues and uses no cookie at all.</p>`],
      ['4. Legal Bases', `
        <p>Processing rests on the following bases in GDPR Art. 6 (Art. 9 of Icelandic act no.
        90/2018):</p>
        <ul>
          <li><strong>Legitimate interests</strong> (Art. 6(1)(f)): first-party analytics, error
          logging and abuse prevention. The interest is running a secure site that works — and
          the processing is designed to be as minimal as we can make it.</li>
          <li><strong>Consent</strong> (Art. 6(1)(a)): third-party analytics cookies. You may
          withdraw consent at any time by clearing this site's cookies.</li>
          <li><strong>Contract or steps taken at your request</strong> (Art. 6(1)(b)): answering
          your enquiry, preparing a proposal, and operating your account.</li>
          <li><strong>Legal obligation</strong> (Art. 6(1)(c)): accounting records.</li>
        </ul>`],
      ['5. How We Use Your Data', `
        <ul>
          <li>To answer enquiries, prepare proposals and keep track of our correspondence</li>
          <li>To maintain signed-in sessions and protect accounts</li>
          <li>To see which pages are used and improve the site</li>
          <li>To find and fix operational errors</li>
        </ul>
        <p>We <strong>never sell</strong> personal data, never use it for ad targeting, and do
        not share it with third parties beyond those listed in section 7.</p>`],
      ['6. Data Retention', `
        <ul>
          <li><strong>Enquiries</strong> — kept in the system for <strong>24 months</strong>
          from receipt and deleted automatically after that (a daily job). The copy in the
          company mailbox lives on like any other correspondence. Ask us to delete at any time
          and we will.</li>
          <li><strong>Session cookies</strong> — expire after <strong>30 days</strong>, and
          expired sessions are purged automatically every day.</li>
          <li><strong>Error logs</strong> — <strong>90 days</strong>, then deleted
          automatically.</li>
          <li><strong>Analytics</strong> — the counts are kept indefinitely as statistics. The
          derived identifier goes stale by itself as soon as the daily secret changes, so older
          rows are plain statistics.</li>
          <li><strong>Accounting records</strong> — <strong>7 years</strong>, as required by
          Icelandic act no. 145/1994 on bookkeeping.</li>
        </ul>`],
      ['7. Processors and Data Location', `
        <ul>
          <li><strong>Microsoft Azure</strong> — hosting for the site and its database, in
          Microsoft's data centre in Sweden, inside the European Economic Area.</li>
          <li><strong>Resend</strong> — email delivery (including enquiries from the form). A US
          company; transfers rely on the EU Standard Contractual Clauses.</li>
          <li><strong>Google Workspace</strong> (Google Ireland Ltd.) — the company mailbox your
          enquiry lands in.</li>
          <li><strong>Stripe</strong> — <em>if</em> a payment is made. Card details go directly
          to Stripe and are never stored by us.</li>
          <li><strong>Sentry</strong> — error diagnostics, where enabled.</li>
          <li><strong>YouTube</strong> (youtube-nocookie.com) — only if you play an embedded
          video. Nothing is fetched from them until you press play.</li>
        </ul>
        <p>Where Orange Smiley operates a system for a customer (section 2), that system's
        sub-processors are governed by the processing agreement with that company.</p>`],
      ['8. Artificial Intelligence', `
        <p>Orange Smiley uses AI in building and operating its systems. Two things are worth
        stating plainly:</p>
        <ul>
          <li>Your enquiry, your email address and other personal data from this site are
          <strong>not sent to any AI service</strong> and are <strong>not used to train AI
          models</strong>.</li>
          <li>Content <em>our own staff write</em> for the site may be translated automatically
          between languages using Anthropic's service. That covers the site's own text, not
          visitors' data.</li>
        </ul>`],
      ['9. Security', `
        <p>All traffic runs over TLS. Passwords are stored as salted hashes, never in readable
        form. Two-factor authentication is available on administrator accounts. Access control
        is role-based and access is limited to those who need it for their work. Secrets are
        scrubbed from event logs before they are stored. No system is perfectly secure, but if a
        breach occurs that is likely to put you at risk we will notify as required by GDPR
        Arts. 33 and 34.</p>`],
      ['10. Your Rights', `
        <p>Under Icelandic act no. 90/2018 and the GDPR you have the right to
        <strong>access</strong> the data we hold about you, to have it
        <strong>corrected</strong>, to have it <strong>erased</strong>, to
        <strong>restrict</strong> its processing, to <strong>object</strong> to processing based
        on legitimate interests, and to receive your data in a
        <strong>portable</strong> machine-readable form.</p>
        <p>Write to <span data-privacy-email></span> and we will respond within one month, free
        of charge. If you are unhappy with the outcome you may complain to the Icelandic Data
        Protection Authority, <strong>Persónuvernd</strong> (personuvernd.is), Laugavegur 166,
        105 Reykjavík.</p>
        <p>If the data concerns a system we operate for another company (section 2), we will
        pass the request to that company, which is the controller of that data.</p>`],
      ['11. Changes to This Policy', `
        <p>This policy may be updated. The date at the top of the page reflects the most recent
        revision. If a change is significant we will say so on the site.</p>`],
    ],
  },
};

export class PrivacyView {
  async render() {
    const copy = COPY[getLocale()] || COPY.is;
    const host = siteHost();
    const view = document.createElement('div');
    view.className = 'view';
    view.innerHTML = `
      <main class="main legal-page" id="main-content">
        <article class="legal-article">
          ${copy.sections.map(([heading, body]) => `
          <section class="legal-section">
            <h2>${heading}</h2>
            ${body.replaceAll('{siteHost}', host)}
          </section>`).join('')}

          <footer class="legal-footer-nav">
            <a href="${href('/')}" class="btn btn--outline">${t('common.backToHome')}</a>
            <button type="button" class="btn btn--outline" id="privacy-cookie-choice" data-testid="privacy-cookie-choice">${t('privacy.changeCookieChoice')}</button>
          </footer>
        </article>
      </main>
    `;

    // "Change cookie choice" shows the banner again; a signed-in answer is
    // saved to the account (services/cookieConsent.js, ice #411).
    view.querySelector('#privacy-cookie-choice')?.addEventListener('click', () => reopenCookieChoice());

    // Obfuscate the address — built from parts so scrapers can't harvest it
    // from the HTML source.
    view.querySelectorAll('[data-privacy-email]').forEach(el => {
      const a = document.createElement('a');
      const addr = ['info', 'orangesmiley.is'].join('@');
      a.href = `mailto:${addr}`;
      a.textContent = addr;
      el.appendChild(a);
    });

    // A waterfall seen from inside a cave — a sheltered place.
    const header = `
          <header class="legal-header">
            <p class="admin-eyebrow">${t('legal.eyebrow')}</p>
            <h1 class="legal-title">${t('privacy.title')}</h1>
            <p class="legal-meta">${copy.updated}</p>
          </header>`;
    const main = view.querySelector('.main');
    this._scene = mountSceneHeader(main, 'personuvernd', header);
    // No manifest entry → the flat header goes back where it was.
    if (!main.contains(this._scene.el())) main.querySelector('.legal-article').insertAdjacentHTML('afterbegin', header);
    return view;
  }

  destroy() {
    this._scene?.destroy();
  }
}
