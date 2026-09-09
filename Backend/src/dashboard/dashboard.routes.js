const router = require('express').Router();
const ctrl = require('./dashboard.controller');
const auth = require('../middleware/auth.middleware');
const permit = require('../middleware/permission.middleware');


router.get('/', auth, ctrl.dashboard);


router.get('/factory', auth, ctrl.factory);

router.get('/maintenance', auth, ctrl.maintenance);

/* Phase 2 · Screen 3 — Preventive Maintenance */
router.get('/preventive', auth, ctrl.preventive);

/* Threshold rules: reading is part of the dashboard, but changing what
   raises tickets is an edit and is gated accordingly. */
router.get('/preventive/thresholds',        auth, ctrl.listThresholds);
router.post('/preventive/thresholds',       auth, permit('page:maintenance:edit'), ctrl.saveThreshold);
router.delete('/preventive/thresholds/:id', auth, permit('page:maintenance:delete'), ctrl.deleteThreshold);
router.post('/preventive/run',              auth, permit('page:maintenance:edit'), ctrl.runPmEngine);

router.get('/live/:machine_id', auth, ctrl.machineDetail);



module.exports = router;