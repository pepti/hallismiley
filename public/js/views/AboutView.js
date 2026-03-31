export class AboutView {
  render() {
    const view = document.createElement('div');
    view.className = 'view';
    view.innerHTML = `
      <main class="main">
        <section class="section about">
          <div class="section__header">
            <h2 class="section__title">About</h2>
          </div>
          <p style="color:var(--text-secondary);font-size:1rem;line-height:1.8;max-width:600px">
            I'm a carpenter and computer scientist who builds things — in wood and in code.
            My work sits at the intersection of traditional craft and modern software engineering,
            where precision, patience, and a love for good systems apply equally.
          </p>

          <div class="about__grid">
            <div class="about__card">
              <div class="about__card-icon">🪚</div>
              <h3 class="about__card-title">Carpentry</h3>
              <p class="about__card-text">
                Furniture making, timber framing, and joinery using both hand tools
                and modern machinery. Each piece designed to last generations.
              </p>
            </div>
            <div class="about__card">
              <div class="about__card-icon">💻</div>
              <h3 class="about__card-title">Computer Science</h3>
              <p class="about__card-text">
                Full-stack development, systems programming, and software architecture.
                Building tools that solve real problems in the workshop and beyond.
              </p>
            </div>
            <div class="about__card">
              <div class="about__card-icon">📐</div>
              <h3 class="about__card-title">Design</h3>
              <p class="about__card-text">
                Both disciplines demand careful design before execution.
                Measure twice, cut once — whether in timber or in code.
              </p>
            </div>
            <div class="about__card">
              <div class="about__card-icon">🔧</div>
              <h3 class="about__card-title">Tools</h3>
              <p class="about__card-text">
                Hand planes, chisels, and mallets alongside Node.js, PostgreSQL, and a
                terminal. The right tool for the right job, always.
              </p>
            </div>
          </div>

          <div style="margin-top:var(--sp-7);padding-top:var(--sp-5);border-top:1px solid var(--border)">
            <p style="font-size:0.8rem;font-family:var(--font-mono);color:var(--text-muted)">
              This portfolio is built with Node.js + Express + PostgreSQL + Vanilla JS · MVC + Component pattern
            </p>
          </div>
        </section>
      </main>
    `;
    return Promise.resolve(view);
  }
}
