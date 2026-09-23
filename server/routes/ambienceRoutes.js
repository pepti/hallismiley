'use strict';
// Live Iceland ambience — public GET, no auth/CSRF (read-only), globalLimiter
// covers it like every route (contentRoutes pattern).
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/ambienceController');

router.get('/', ctrl.getAmbience);

module.exports = router;
