/**
 * FTP transfer to CNC controllers (Fanuc / Mitsubishi).
 *
 * Both controller families run a built-in FTP server on the machine
 * LAN port. Sending a program = FTP upload of the NC file into the
 * controller's program directory; the operator then selects it on
 * the control panel and presses CYCLE START.
 *
 * Fanuc note: the embedded FTP server only supports active-mode
 * listings on some models, but plain STOR uploads work in passive
 * mode on 30i/31i/0i-F series. Mitsubishi M700/M800 accept standard
 * passive uploads.
 */
const ftp = require('basic-ftp');
const { Readable, Writable } = require('stream');

const TRANSFER_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS  = 10_000;

/**
 * Open a logged-in FTP client for a machine, optionally moved into its
 * program directory. Every operation below goes through here so the
 * connection settings stay in one place.
 */
async function connect(machine, { timeout = TRANSFER_TIMEOUT_MS, enterDir = false } = {}) {
  if (!machine.ip_address) {
    throw new Error('Machine has no IP address configured. Edit the machine and set its FTP details.');
  }

  const client = new ftp.Client(timeout);
  try {
    await client.access({
      host:     machine.ip_address,
      port:     machine.ftp_port || 21,
      user:     machine.ftp_user || 'anonymous',
      password: machine.ftp_pass || '',
      secure:   false   // CNC controllers do not support FTPS
    });

    if (enterDir && machine.ftp_dir) {
      await client.ensureDir(machine.ftp_dir);
    }
    return client;
  } catch (err) {
    client.close();
    throw err;
  }
}

/**
 * Upload a program buffer to a machine over FTP.
 *
 * @param {object}   machine  - { ip_address, ftp_port, ftp_user, ftp_pass, ftp_dir }
 * @param {Buffer}   content  - raw G-code file bytes
 * @param {string}   fileName - target file name on the CNC (e.g. O1234.nc)
 * @param {function} [onProgress] - called with ({ bytes, total }) as it streams
 */
async function sendProgramToMachine(machine, content, fileName, onProgress) {
  const client = await connect(machine, { enterDir: true });
  try {
    if (typeof onProgress === 'function') {
      client.trackProgress(info => onProgress({ bytes: info.bytes, total: content.length }));
    }
    await client.uploadFrom(Readable.from(content), fileName);
  } finally {
    client.trackProgress();   // detach handler before the socket closes
    client.close();
  }
}

/**
 * Pull a program off the controller into memory.
 * Programs are small text files, so buffering is fine and lets the
 * caller store the bytes without a temp file.
 *
 * @returns {Promise<Buffer>}
 */
async function fetchProgramFromMachine(machine, fileName, onProgress) {
  const client = await connect(machine, { enterDir: true });
  const chunks = [];

  try {
    if (typeof onProgress === 'function') {
      client.trackProgress(info => onProgress({ bytes: info.bytes, total: 0 }));
    }

    const sink = new Writable({
      write(chunk, _enc, cb) { chunks.push(chunk); cb(); }
    });

    await client.downloadTo(sink, fileName);
    return Buffer.concat(chunks);
  } finally {
    client.trackProgress();
    client.close();
  }
}

/**
 * List NC programs sitting on the controller.
 * Returns name, size and modified date — the columns the file browser shows.
 */
async function listMachineFiles(machine) {
  const client = await connect(machine, { enterDir: true });
  try {
    const entries = await client.list();
    return entries
      .filter(e => e.isFile)
      .map(e => ({
        name:        e.name,
        size:        e.size,
        modified_at: e.modifiedAt || e.rawModifiedAt || null
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    client.close();
  }
}

/**
 * Does this file already exist on the controller?
 * Used to raise an overwrite confirmation before clobbering a program
 * an operator may be mid-way through running.
 */
async function machineFileExists(machine, fileName) {
  const files = await listMachineFiles(machine);
  const target = String(fileName).toLowerCase();
  return files.some(f => f.name.toLowerCase() === target);
}

/**
 * Quick connectivity check — connects and logs in, nothing else.
 * Used by the "Test Connection" button and the live status indicator.
 */
async function testMachineConnection(machine) {
  const client = await connect(machine, { timeout: CONNECT_TIMEOUT_MS });
  client.close();
}

module.exports = {
  sendProgramToMachine,
  fetchProgramFromMachine,
  listMachineFiles,
  machineFileExists,
  testMachineConnection
};
