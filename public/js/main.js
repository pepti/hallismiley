import { tryRestoreSession } from './services/auth.js';
import { NavBar } from './components/NavBar.js';
import { Router } from './router.js';

// Silently try to restore session from refresh token cookie before first render
await tryRestoreSession();

const navBar = new NavBar();
const navEl  = navBar.render();
document.body.insertBefore(navEl, document.getElementById('app'));

const router = new Router(document.getElementById('app'), navBar);
router.init();
