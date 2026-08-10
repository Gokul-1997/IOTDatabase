const pool = require('../db');
const {
  sendProgramToMachine,
  fetchProgramFromMachine,
  listMachineFiles,
  machineFileExists,
  testMachineConnection
} = require('./program.transfer');
const { emitToUser } = require('../lib/realtime');

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

/** Load a machine the caller is allowed to touch, or throw. */
async function getMachine(machineId, companyId) {
  const { rows, rowCount } = await pool.query(
    `SELECT id, machine_serial_no, ip_address, ftp_port, ftp_user, ftp_pass, ftp_dir
     FROM machines
     WHERE id = $1 AND company_id = $2 AND is_active = true`,
    [machineId, companyId]
  );
  if (rowCount === 0) throw new Error('Machine not found or access denied');
  return rows[0];
}

/** Raise a 409 the frontend can turn into an overwrite prompt. */
function fileExistsError(fileName) {
  const e = new Error(`"${fileName}" already exists on the controller.`);
  e.status = 409;
  e.code = 'FILE_EXISTS';
  return e;
}

/**
 * Notify the user who ran the transfer. Best-effort: a failure to write
 * the notification must never mask the transfer result itself.
 */
async function notifyTransfer({ companyId, userId, ok, direction, programName, machineSerial, reason }) {
  const verb = direction === 'DOWNLOAD' ? 'received from' : 'sent to';
  const title = ok
    ? `Program ${verb} ${machineSerial}`
    : `Program transfer failed — ${machineSerial}`;
  const message = ok
    ? `"${programName}" was ${verb} ${machineSerial}.`
    : `"${programName}" could not be ${direction === 'DOWNLOAD' ? 'received from' : 'sent to'} ${machineSerial}. ${reason || ''}`.trim();

  try {
    await pool.query(
      `INSERT INTO notifications (company_id, user_id, type, title, message, link)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [companyId, userId, ok ? 'INFO' : 'WARNING', title, message, '/programs']
    );
  } catch (err) {
    console.error('Transfer notification failed:', err.message);
  }
}

/** Stream byte-level progress to the initiating user's open tabs. */
function progressEmitter(userId, transferId, fileName, direction) {
  return ({ bytes, total }) => {
    emitToUser(userId, 'programTransferProgress', {
      transfer_id: transferId,
      file_name:   fileName,
      direction,
      bytes,
      total,
      percent: total > 0 ? Math.min(100, Math.round((bytes / total) * 100)) : null
    });
  };
}

/* ─────────────────────────────────────────────────────────────
   Programs stored on the server
   ───────────────────────────────────────────────────────────── */

/* UPLOAD PROGRAM (G-code / NC file) */
exports.createProgram = async (req) => {
  if (!req.file) {
    throw new Error('No program file uploaded');
  }

  const { name, description } = req.body;
  const file = req.file;

  const result = await pool.query(
    `INSERT INTO programs (company_id, name, file_name, content, file_size, description, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, file_name, file_size, description, created_at`,
    [
      req.user.company_id,
      name || file.originalname,
      file.originalname,
      file.buffer,
      file.size,
      description || null,
      req.user.id
    ]
  );

  return result.rows[0];
};

/* LIST PROGRAMS */
exports.getPrograms = async (req) => {
  const { search = '', page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;
  const values = [req.user.company_id];

  let whereSQL = `WHERE p.company_id = $1 AND p.is_active = true`;
  if (search) {
    values.push(`%${search}%`);
    whereSQL += ` AND (p.name ILIKE $${values.length} OR p.file_name ILIKE $${values.length})`;
  }

  const dataQuery = `
    SELECT p.id, p.name, p.file_name, p.file_size, p.description, p.created_at,
           u.username AS uploaded_by_name
    FROM programs p
    LEFT JOIN users u ON u.id = p.uploaded_by
    ${whereSQL}
    ORDER BY p.created_at DESC
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}
  `;

  const countQuery = `SELECT COUNT(*)::int AS total FROM programs p ${whereSQL}`;

  const [dataRes, countRes] = await Promise.all([
    pool.query(dataQuery, [...values, limit, offset]),
    pool.query(countQuery, values)
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total };
};

/* DOWNLOAD PROGRAM FILE */
exports.getProgramFile = async (req) => {
  const result = await pool.query(
    `SELECT file_name, content FROM programs
     WHERE id = $1 AND company_id = $2 AND is_active = true`,
    [req.params.id, req.user.company_id]
  );
  if (result.rowCount === 0) {
    throw new Error('Program not found or access denied');
  }
  return result.rows[0];
};

/* DELETE PROGRAM (soft delete — transfer history keeps its name) */
exports.deleteProgram = async (req) => {
  const result = await pool.query(
    `UPDATE programs SET is_active = false
     WHERE id = $1 AND company_id = $2
     RETURNING id`,
    [req.params.id, req.user.company_id]
  );
  if (result.rowCount === 0) {
    throw new Error('Program not found or access denied');
  }
};

/* ─────────────────────────────────────────────────────────────
   Programs living on the controller
   ───────────────────────────────────────────────────────────── */

/* BROWSE FILES ON THE CNC */
exports.listMachinePrograms = async (req) => {
  const machine = await getMachine(req.params.machineId, req.user.company_id);
  const files = await listMachineFiles(machine);

  const { search = '' } = req.query;
  const term = String(search).trim().toLowerCase();
  return term
    ? files.filter(f => f.name.toLowerCase().includes(term))
    : files;
};

/* CONNECTION STATUS — one machine, for the live indicator */
exports.getMachineStatus = async (req) => {
  const machine = await getMachine(req.params.machineId, req.user.company_id);
  try {
    await testMachineConnection(machine);
    return { machine_id: machine.id, online: true };
  } catch (err) {
    return { machine_id: machine.id, online: false, reason: err.message };
  }
};

/* ─────────────────────────────────────────────────────────────
   Transfers
   ───────────────────────────────────────────────────────────── */

/**
 * Send one stored program to one machine.
 * Shared by the single and batch endpoints so both log and notify
 * identically.
 */
async function uploadOne({ program, machine, user, overwrite }) {
  const companyId = user.company_id;

  if (!overwrite && await machineFileExists(machine, program.file_name)) {
    throw fileExistsError(program.file_name);
  }

  // log first so an interrupted transfer still leaves a trace
  const { rows: [{ id: transferId }] } = await pool.query(
    `INSERT INTO program_transfers
       (company_id, program_id, machine_id, program_name, file_name, machine_serial,
        direction, file_size, status, transferred_by)
     VALUES ($1,$2,$3,$4,$5,$6,'UPLOAD',$7,'PENDING',$8)
     RETURNING id`,
    [companyId, program.id, machine.id, program.name, program.file_name,
     machine.machine_serial_no, program.content?.length || null, user.id]
  );

  try {
    await sendProgramToMachine(
      machine, program.content, program.file_name,
      progressEmitter(user.id, transferId, program.file_name, 'UPLOAD')
    );

    await pool.query(
      `UPDATE program_transfers SET status = 'SUCCESS', finished_at = NOW() WHERE id = $1`,
      [transferId]
    );
    await notifyTransfer({
      companyId, userId: user.id, ok: true, direction: 'UPLOAD',
      programName: program.name, machineSerial: machine.machine_serial_no
    });

    return { transfer_id: transferId, status: 'SUCCESS' };
  } catch (err) {
    await pool.query(
      `UPDATE program_transfers SET status = 'FAILED', error_message = $2, finished_at = NOW() WHERE id = $1`,
      [transferId, err.message]
    );
    await notifyTransfer({
      companyId, userId: user.id, ok: false, direction: 'UPLOAD',
      programName: program.name, machineSerial: machine.machine_serial_no, reason: err.message
    });

    const e = new Error(`Transfer failed: ${err.message}`);
    e.status = 502;
    throw e;
  }
}

/** Load a stored program with its bytes, or throw. */
async function getProgram(programId, companyId) {
  const { rows, rowCount } = await pool.query(
    `SELECT id, name, file_name, content FROM programs
     WHERE id = $1 AND company_id = $2 AND is_active = true`,
    [programId, companyId]
  );
  if (rowCount === 0) throw new Error('Program not found or access denied');
  return rows[0];
}

/* TRANSFER PROGRAM TO MACHINE via FTP */
exports.transferProgram = async (req) => {
  const { id: programId, machineId } = req.params;
  const overwrite = req.body?.overwrite === true || req.query?.overwrite === 'true';

  const [program, machine] = await Promise.all([
    getProgram(programId, req.user.company_id),
    getMachine(machineId, req.user.company_id)
  ]);

  return uploadOne({ program, machine, user: req.user, overwrite });
};

/**
 * BATCH TRANSFER — any number of programs to any number of machines.
 * One machine failing must not abort the rest, so every combination is
 * attempted and reported individually.
 */
exports.transferBatch = async (req) => {
  const { program_ids = [], machine_ids = [], overwrite = false } = req.body || {};

  if (!Array.isArray(program_ids) || program_ids.length === 0) {
    throw new Error('Select at least one program to transfer');
  }
  if (!Array.isArray(machine_ids) || machine_ids.length === 0) {
    throw new Error('Select at least one machine to transfer to');
  }

  const companyId = req.user.company_id;
  const [programs, machines] = await Promise.all([
    Promise.all(program_ids.map(id => getProgram(id, companyId))),
    Promise.all(machine_ids.map(id => getMachine(id, companyId)))
  ]);

  const results = [];
  for (const machine of machines) {
    for (const program of programs) {
      try {
        const r = await uploadOne({ program, machine, user: req.user, overwrite });
        results.push({
          program_id: program.id, program_name: program.name,
          machine_id: machine.id, machine_serial: machine.machine_serial_no,
          status: 'SUCCESS', transfer_id: r.transfer_id
        });
      } catch (err) {
        results.push({
          program_id: program.id, program_name: program.name,
          machine_id: machine.id, machine_serial: machine.machine_serial_no,
          status: err.code === 'FILE_EXISTS' ? 'EXISTS' : 'FAILED',
          code: err.code, message: err.message
        });
      }
    }
  }

  const succeeded = results.filter(r => r.status === 'SUCCESS').length;
  return { total: results.length, succeeded, failed: results.length - succeeded, results };
};

/**
 * PULL A PROGRAM OFF THE CONTROLLER into the server library.
 * Requirement: "download programs from the CNC Controller to the Local PC".
 */
exports.fetchFromMachine = async (req) => {
  const { machineId } = req.params;
  const { file_name } = req.body || {};
  if (!file_name) throw new Error('file_name is required');

  const companyId = req.user.company_id;
  const machine = await getMachine(machineId, companyId);

  const { rows: [{ id: transferId }] } = await pool.query(
    `INSERT INTO program_transfers
       (company_id, machine_id, program_name, file_name, machine_serial,
        direction, status, transferred_by)
     VALUES ($1,$2,$3,$4,$5,'DOWNLOAD','PENDING',$6)
     RETURNING id`,
    [companyId, machine.id, file_name, file_name, machine.machine_serial_no, req.user.id]
  );

  try {
    const content = await fetchProgramFromMachine(
      machine, file_name,
      progressEmitter(req.user.id, transferId, file_name, 'DOWNLOAD')
    );

    const { rows: [program] } = await pool.query(
      `INSERT INTO programs
         (company_id, name, file_name, content, file_size, description, uploaded_by, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'CNC')
       RETURNING id, name, file_name, file_size, created_at`,
      [companyId, file_name, file_name, content, content.length,
       `Retrieved from ${machine.machine_serial_no}`, req.user.id]
    );

    await pool.query(
      `UPDATE program_transfers
       SET status='SUCCESS', finished_at=NOW(), program_id=$2, file_size=$3
       WHERE id=$1`,
      [transferId, program.id, content.length]
    );
    await notifyTransfer({
      companyId, userId: req.user.id, ok: true, direction: 'DOWNLOAD',
      programName: file_name, machineSerial: machine.machine_serial_no
    });

    return { transfer_id: transferId, status: 'SUCCESS', program };
  } catch (err) {
    await pool.query(
      `UPDATE program_transfers SET status = 'FAILED', error_message = $2, finished_at = NOW() WHERE id = $1`,
      [transferId, err.message]
    );
    await notifyTransfer({
      companyId, userId: req.user.id, ok: false, direction: 'DOWNLOAD',
      programName: file_name, machineSerial: machine.machine_serial_no, reason: err.message
    });

    const e = new Error(`Download failed: ${err.message}`);
    e.status = 502;
    throw e;
  }
};

/* TRANSFER HISTORY */
exports.getTransfers = async (req) => {
  const { page = 1, limit = 20, machine_id, direction } = req.query;
  const offset = (page - 1) * limit;
  const values = [req.user.company_id];

  let whereSQL = `WHERE t.company_id = $1`;
  if (machine_id) {
    values.push(machine_id);
    whereSQL += ` AND t.machine_id = $${values.length}`;
  }
  if (direction) {
    values.push(String(direction).toUpperCase());
    whereSQL += ` AND t.direction = $${values.length}`;
  }

  const dataQuery = `
    SELECT t.id, t.program_name, t.file_name, t.machine_serial, t.status,
           t.direction, t.file_size, t.error_message, t.started_at, t.finished_at,
           u.username AS transferred_by_name
    FROM program_transfers t
    LEFT JOIN users u ON u.id = t.transferred_by
    ${whereSQL}
    ORDER BY t.started_at DESC
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}
  `;

  const countQuery = `SELECT COUNT(*)::int AS total FROM program_transfers t ${whereSQL}`;

  const [dataRes, countRes] = await Promise.all([
    pool.query(dataQuery, [...values, limit, offset]),
    pool.query(countQuery, values)
  ]);

  return { data: dataRes.rows, total: countRes.rows[0].total };
};

/* TEST FTP CONNECTION
   Accepts FTP details in the body so the machine form can test unsaved
   values. When machine_id is given and a field is blank, falls back to
   the stored value — the password is never sent to the frontend (it is
   write-only), so a blank password means "use the saved one". */
exports.testConnection = async (req) => {
  const { machine_id, ip_address, ftp_port, ftp_user, ftp_pass } = req.body || {};

  let config = { ip_address, ftp_port, ftp_user, ftp_pass };

  if (machine_id) {
    const result = await pool.query(
      `SELECT ip_address, ftp_port, ftp_user, ftp_pass
       FROM machines
       WHERE id = $1 AND company_id = $2`,
      [machine_id, req.user.company_id]
    );
    if (result.rowCount === 0) throw new Error('Machine not found or access denied');
    const stored = result.rows[0];
    config = {
      ip_address: ip_address || stored.ip_address,
      ftp_port:   ftp_port   || stored.ftp_port,
      ftp_user:   ftp_user   || stored.ftp_user,
      ftp_pass:   ftp_pass   || stored.ftp_pass
    };
  }

  await testMachineConnection(config);
};

/* MARK STUCK 'PENDING' TRANSFERS AS FAILED
   FTP transfers time out after 30s; anything PENDING for over 5 minutes
   means the server restarted or the connection hung mid-transfer.
   Called by the cron scheduler every 10 minutes. */
exports.cleanupStuckTransfers = async () => {
  const result = await pool.query(
    `UPDATE program_transfers
     SET status = 'FAILED',
         error_message = 'Transfer interrupted — server restarted or connection hung',
         finished_at = NOW()
     WHERE status = 'PENDING'
       AND started_at < NOW() - INTERVAL '5 minutes'
     RETURNING id`
  );
  return result.rowCount;
};
