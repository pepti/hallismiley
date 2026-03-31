export class NotFoundView {
  async render() {
    const view = document.createElement('div');
    view.className = 'view';
    view.innerHTML = `
      <main class="main not-found" id="main-content">
        <div class="not-found__inner">
          <p class="not-found__code">404</p>
          <h1 class="not-found__title">Page Not Found</h1>
          <p class="not-found__desc">
            This page has gone the way of a miscut tenon — beyond repair.
            Let's get you back to solid ground.
          </p>
          <a href="#/" class="btn btn--primary">Back to Home</a>
        </div>
      </main>
    `;
    return view;
  }
}
