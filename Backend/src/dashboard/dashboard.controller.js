const svc = require('./dashboard.service');
const factorySvc = require('./factory.service');
const maintenanceSvc = require('./maintenance.service');
const preventiveSvc  = require('./preventive.service');
const pmEngine       = require('../maintenance/pm-engine.service');
const periodicSvc   = require('./periodic.service');
const periodicEngine = require('../maintenance/periodic-engine.service');
const excel         = require('../reports/excel.util');
const PDFDocument   = require('pdfkit');

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
/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 4 — Periodic Maintenance
   Time-based maintenance: due because the calendar says so, as opposed
   to Screen 3's work which is due because a machine started alarming.
   ───────────────────────────────────────────────────────────── */

exports.periodic = async (req, res) => {
  try {
    const data = await periodicSvc.getPeriodic({
      company_id: req.user.company_id,
      machine_id: req.query.machine_id,
      search:     req.query.search,
      status:     req.query.status,
      page:       req.query.page,
      limit:      req.query.limit
    });
    return res.json({ status: 'success', data });
  } catch (err) {
    console.error('Periodic dashboard error:', err);
    return res.status(err.status || 500).json({ status: 'error', message: err.message });
  }
};

exports.listPeriodicSchedules = async (req, res) => {
  try {
    const data = await periodicSvc.listSchedules({
      company_id: req.user.company_id,
      machine_id: req.query.machine_id
    });
    return res.json({ status: 'success', data });
  } catch (err) {
    return res.status(err.status || 500).json({ status: 'error', message: err.message });
  }
};

exports.savePeriodicSchedule = async (req, res) => {
  try {
    const data = await periodicSvc.upsertSchedule({
      ...req.body,
      company_id: req.user.company_id,
      user_id:    req.user.id
    });
    return res.json({ status: 'success', data });
  } catch (err) {
    return res.status(err.status || 500).json({ status: 'error', message: err.message });
  }
};

exports.deletePeriodicSchedule = async (req, res) => {
  try {
    await periodicSvc.deleteSchedule({ id: req.params.id, company_id: req.user.company_id });
    return res.json({ status: 'success' });
  } catch (err) {
    return res.status(err.status || 500).json({ status: 'error', message: err.message });
  }
};

/* Raise the occurrences that are due now instead of waiting for the cron. */
exports.runPeriodicEngine = async (req, res) => {
  try {
    const result = await periodicEngine.evaluateCompany(req.user.company_id, { createdBy: req.user.id });
    return res.json({
      status: 'success', data: result,
      message: `${result.created} periodic ticket(s) raised from ${result.advanced} schedule(s)`
    });
  } catch (err) {
    console.error('Periodic engine error:', err);
    return res.status(err.status || 500).json({ status: 'error', message: err.message });
  }
};

/* Export the ticket list. Excel and CSV come from the same rows so the two
   downloads can never disagree; PDF is a printed summary, not a data dump. */
exports.exportPeriodic = async (req, res) => {
  try {
    const format = String(req.params.format || '').toLowerCase();
    const rows = await periodicSvc.getExportRows({
      company_id: req.user.company_id,
      machine_id: req.query.machine_id,
      search:     req.query.search,
      status:     req.query.status
    });

    if (!rows.length) {
      return res.status(404).json({ status: 'error', message: 'Nothing to export for these filters' });
    }

    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'xlsx') {
      const file = excel.createExcel('Periodic Maintenance', rows);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=periodic_maintenance_${stamp}.xlsx`);
      return res.send(file);
    }

    if (format === 'csv') {
      return res.type('text/csv')
        .setHeader('Content-Disposition', `attachment; filename=periodic_maintenance_${stamp}.csv`)
        .send(toCsv(rows));
    }

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=periodic_maintenance_${stamp}.pdf`);
      return periodicPdf(rows, res);
    }

    return res.status(400).json({ status: 'error', message: 'format must be xlsx, csv or pdf' });
  } catch (err) {
    console.error('Periodic export error:', err);
    return res.status(err.status || 500).json({ status: 'error', message: err.message });
  }
};

/**
 * Minimal RFC 4180 CSV.
 *
 * Quoting is not optional here: machine serials and task titles contain
 * commas, and a value with one would otherwise shift every later column on
 * that row — a corruption that looks like clean data when opened.
 */
function toCsv(rows) {
  const headers = Object.keys(rows[0]);
  const cell = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => cell(r[h])).join(','))].join('\r\n');
}

/** A printable summary, streamed so a large export never buffers in memory. */
function periodicPdf(rows, res) {
  const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
  doc.pipe(res);

  doc.fontSize(16).text('Periodic Maintenance', { align: 'left' });
  doc.fontSize(9).fillColor('#555')
     .text(`Generated ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} — ${rows.length} record(s)`);
  doc.moveDown(0.8).fillColor('#000');

  const headers = ['Ticket', 'Machine', 'Task', 'Frequency', 'Status', 'Due date', 'Overdue', 'Technician'];
  const widths  = [45, 90, 190, 70, 70, 70, 55, 100];
  const left = doc.page.margins.left;

  const row = (cells, bold) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    let x = left;
    cells.forEach((c, i) => {
      doc.text(String(c ?? ''), x, y, { width: widths[i] - 6, ellipsis: true });
      x += widths[i];
    });
    doc.y = y + 14;
  };

  row(headers, true);
  doc.moveTo(left, doc.y - 3).lineTo(left + widths.reduce((a, b) => a + b, 0), doc.y - 3)
     .strokeColor('#ccc').stroke();

  for (const r of rows) {
    // Start a new page before writing, never after — writing first would
    // put a clipped half-row at the bottom of the page.
    if (doc.y > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      row(headers, true);
    }
    row([r['Ticket'], r['Machine'], r['Task'], r['Frequency'],
         r['Status'], r['Due date'], r['Overdue'], r['Technician']]);
  }

  doc.end();
}

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
