const svc = require('./dashboard.service');
const factorySvc = require('./factory.service');
const maintenanceSvc = require('./maintenance.service');
const preventiveSvc  = require('./preventive.service');
const pmEngine       = require('../maintenance/pm-engine.service');

/* =====================================================
   DASHBOARD (Paginated Machine Cards)
   GET /dashboard?page=1&per_page=6
===================================================== */
exports.dashboard = async (req, res) => {
  try {

    const data = await svc.dashboard(req.user.plant_id, req.user.company_id);

    return res.json({
      status: "success",
      ...data
    });

  } catch (err) {
    console.error("Dashboard Error:", err);
    return res.status(500).json({
      status: "error",
      message: "Failed to load dashboard"
    });
  }
};




/* =====================================================
   MACHINE DETAIL
   GET /dashboard/:machine_id/detail
===================================================== */
exports.machineDetail = async (req, res) => {

  try {

    const machineId = parseInt(req.params.machine_id);

    if (!machineId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid machine ID"
      });
    }

    const data = await svc.machineDetail(
      req.user.plant_id,
      machineId,
      req.user.company_id
    );

    return res.json({
      status: "success",
      data
    });

  } catch (err) {

    console.error("Machine Detail Error:", err);

    return res.status(500).json({
      status: "error",
      message: "Failed to load machine detail"
    });

  }

};
/* =====================================================
   FACTORY OVERALL DASHBOARD (Phase 2 · Screen 1)
   GET /dashboard/factory?date=&shift_id=&machine_id=
===================================================== */
/* Phase 2 · Screen 3 — Preventive Maintenance Dashboard */
exports.preventive = async (req, res) => {
  try {
    const data = await preventiveSvc.getPreventiveDashboard(req);
    return res.json({ status: 'success', data });
  } catch (err) {
    console.error('Preventive dashboard error:', err);
    return res.status(err.status || 500).json({ status: 'error', message: err.message });
  }
};

/* Threshold rules — what turns repeated alarms into PM tickets. */
exports.listThresholds = async (req, res) => {
  try {
    const data = await preventiveSvc.listThresholds(req.user.company_id);
    return res.json({ status: 'success', data });
  } catch (err) {
    return res.status(err.status || 500).json({ status: 'error', message: err.message });
  }
};

exports.saveThreshold = async (req, res) => {
  try {
    const data = await preventiveSvc.upsertThreshold(req.user.company_id, req.body, req.user.id);
    return res.json({ status: 'success', data });
  } catch (err) {
    return res.status(err.status || 500).json({ status: 'error', message: err.message });
  }
};

exports.deleteThreshold = async (req, res) => {
  try {
    await preventiveSvc.deleteThreshold(req.user.company_id, req.params.id);
    return res.json({ status: 'success' });
  } catch (err) {
    return res.status(err.status || 500).json({ status: 'error', message: err.message });
  }
};

/* Run the engine now rather than waiting for the next cron tick. */
exports.runPmEngine = async (req, res) => {
  try {
    const result = await pmEngine.evaluateCompany(req.user.company_id, { createdBy: req.user.id });
    return res.json({ status: 'success', data: result,
      message: `${result.created} preventive ticket(s) raised` });
  } catch (err) {
    console.error('PM engine error:', err);
    return res.status(err.status || 500).json({ status: 'error', message: err.message });
  }
};

/* Phase 2 · Screen 2 — Maintenance Dashboard */
exports.maintenance = async (req, res) => {
  try {
    const data = await maintenanceSvc.getMaintenanceDashboard(req);
    return res.json({ status: 'success', data });
  } catch (err) {
    console.error('Maintenance dashboard error:', err);
    return res.status(err.status || 500).json({ status: 'error', message: err.message });
  }
};

exports.factory = async (req, res) => {
  try {
    const data = await factorySvc.getFactoryDashboard(req);
    return res.json({ status: 'success', data });
  } catch (err) {
    console.error('Factory dashboard error:', err);
    return res.status(err.status || 500).json({ status: 'error', message: err.message });
  }
};
