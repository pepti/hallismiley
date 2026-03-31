// Singleton toast manager
let container;

function getContainer() {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, type = 'success', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;

  const c = getContainer();
  c.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 200ms';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, duration);
}
