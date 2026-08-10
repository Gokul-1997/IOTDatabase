const express = require('express');
const router = express.Router();
const multer = require('multer');

const auth = require('../middleware/auth.middleware');
const controller = require('./program.controller');

// G-code / NC program files are plain text; accept by extension
// since controllers and CAM software produce inconsistent MIME types.
const ALLOWED_EXTENSIONS = ['.nc', '.prg', '.cnc', '.txt', '.tap', '.eia', '.min', '.gcode'];

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ext = (file.originalname.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`), false);
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB — NC programs are small text files
});

// Upload a new program
router.post('/', auth, upload.single('file'), controller.createProgram);

// List programs
router.get('/', auth, controller.getPrograms);

// Transfer history (must come before /:id routes)
router.get('/transfers', auth, controller.getTransfers);

// Test FTP connection (body: machine_id and/or ip_address, ftp_port, ftp_user, ftp_pass)
router.post('/test-connection', auth, controller.testConnection);

/* ── controller-side file browser ──
   Literal segments before the /:id routes so "machine" is never read
   as a program id. */
router.get('/machine/:machineId/files',  auth, controller.listMachinePrograms);
router.get('/machine/:machineId/status', auth, controller.getMachineStatus);
router.post('/machine/:machineId/fetch', auth, controller.fetchFromMachine);

// Send several programs to several machines in one action
router.post('/transfer-batch', auth, controller.transferBatch);

// Download original program file
router.get('/:id/download', auth, controller.downloadProgram);

// Send program to machine over FTP
router.post('/:id/transfer/:machineId', auth, controller.transferProgram);

// Delete program
router.delete('/:id', auth, controller.deleteProgram);

module.exports = router;
