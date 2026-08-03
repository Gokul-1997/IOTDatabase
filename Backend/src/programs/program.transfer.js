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
const { Readable } = require('stream');

const TRANSFER_TIMEOUT_MS = 30_000;

/**
 * Upload a program buffer to a machine over FTP.
 *
 * @param {object} machine - { ip_address, ftp_port, ftp_user, ftp_pass, ftp_dir }
 * @param {Buffer} content - raw G-code file bytes
 * @param {string} fileName - target file name on the CNC (e.g. O1234.nc)
 */
async function sendProgramToMachine(machine, content, fileName) {
  if (!machine.ip_address) {
    throw new Error('Machine has no IP address configured. Edit the machine and set its FTP details.');
  }

  const client = new ftp.Client(TRANSFER_TIMEOUT_MS);

  try {
    await client.access({
      host:     machine.ip_address,
      port:     machine.ftp_port || 21,
      user:     machine.ftp_user || 'anonymous',
      password: machine.ftp_pass || '',
      secure:   false   // CNC controllers do not support FTPS
    });

    if (machine.ftp_dir) {
      await client.ensureDir(machine.ftp_dir);
    }

    await client.uploadFrom(Readable.from(content), fileName);
  } finally {
    client.close();
  }
}

/**
 * Quick connectivity check — connects and logs in, nothing else.
 * Used by the "Test Connection" button on the machine form.
 */
async function testMachineConnection(machine) {
  if (!machine.ip_address) {
    throw new Error('Machine has no IP address configured.');
  }

  const client = new ftp.Client(10_000);
  try {
    await client.access({
      host:     machine.ip_address,
      port:     machine.ftp_port || 21,
      user:     machine.ftp_user || 'anonymous',
      password: machine.ftp_pass || '',
      secure:   false
    });
  } finally {
    client.close();
  }
}

module.exports = { sendProgramToMachine, testMachineConnection };
