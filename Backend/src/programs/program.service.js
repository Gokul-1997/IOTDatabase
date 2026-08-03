const pool = require('../db');
const { sendProgramToMachine, testMachineConnection } = require('./program.transfer');

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

/* TRANSFER PROGRAM TO MACHINE via FTP */
exports.transferProgram = async (req) => {
  const { id: programId, machineId } = req.params;
  const companyId = req.user.company_id;

  const [programRes, machineRes] = await Promise.all([
    pool.query(
      `SELECT id, name, file_name, content FROM programs
       WHERE id = $1 AND company_id = $2 AND is_active = true`,
      [programId, companyId]
    ),
    pool.query(
      `SELECT id, machine_serial_no, ip_address, ftp_port, ftp_user, ftp_pass, ftp_dir
       FROM machines
       WHERE id = $1 AND company_id = $2 AND is_active = true`,
      [machineId, companyId]
    )
  ]);

  if (programRes.rowCount === 0) throw new Error('Program not found or access denied');
  if (machineRes.rowCount === 0) throw new Error('Machine not found or access denied');

  const program = programRes.rows[0];
  const machine = machineRes.rows[0];

  // log the attempt first so failures are visible in history
  const logRes = await pool.query(
    `INSERT INTO program_transfers
       (company_id, program_id, machine_id, program_name, file_name, machine_serial, status, transferred_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)
     RETURNING id`,
    [companyId, program.id, machine.id, program.name, program.file_name,
     machine.machine_serial_no, req.user.id]
  );
  const transferId = logRes.rows[0].id;

  try {
    await sendProgramToMachine(machine, program.content, program.file_name);

    await pool.query(
      `UPDATE program_transfers
       SET status = 'SUCCESS', finished_at = NOW()
       WHERE id = $1`,
      [transferId]
    );

    return { transfer_id: transferId, status: 'SUCCESS' };
  } catch (err) {
    await pool.query(
      `UPDATE program_transfers
       SET status = 'FAILED', error_message = $2, finished_at = NOW()
       WHERE id = $1`,
      [transferId, err.message]
    );

    const e = new Error(`Transfer failed: ${err.message}`);
    e.status = 502;
    throw e;
  }
};

/* TRANSFER HISTORY */
exports.getTransfers = async (req) => {
  const { page = 1, limit = 20, machine_id } = req.query;
  const offset = (page - 1) * limit;
  const values = [req.user.company_id];

  let whereSQL = `WHERE t.company_id = $1`;
  if (machine_id) {
    values.push(machine_id);
    whereSQL += ` AND t.machine_id = $${values.length}`;
  }

  const dataQuery = `
    SELECT t.id, t.program_name, t.file_name, t.machine_serial, t.status,
           t.error_message, t.started_at, t.finished_at,
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
