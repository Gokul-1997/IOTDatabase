const service = require('./program.service');

exports.createProgram = async (req, res) => {
  try {
    const data = await service.createProgram(req);
    res.json({ status: 'success', data });
  } catch (e) {
    res.status(400).json({ status: 'error', message: e.message });
  }
};

exports.getPrograms = async (req, res) => {
  try {
    const result = await service.getPrograms(req);
    res.json({ status: 'success', data: result.data, total: result.total });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
};

exports.downloadProgram = async (req, res) => {
  try {
    const file = await service.getProgramFile(req);
    res.setHeader('Content-Disposition', `attachment; filename="${file.file_name}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(file.content);
  } catch (e) {
    res.status(404).json({ status: 'error', message: e.message });
  }
};

exports.deleteProgram = async (req, res) => {
  try {
    await service.deleteProgram(req);
    res.json({ status: 'success', message: 'Program deleted successfully' });
  } catch (e) {
    res.status(400).json({ status: 'error', message: e.message });
  }
};

exports.transferProgram = async (req, res) => {
  try {
    const data = await service.transferProgram(req);
    res.json({ status: 'success', data, message: 'Program transferred to machine' });
  } catch (e) {
    res.status(e.status || 400).json({ status: 'error', message: e.message });
  }
};

exports.getTransfers = async (req, res) => {
  try {
    const result = await service.getTransfers(req);
    res.json({ status: 'success', data: result.data, total: result.total });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
};

exports.testConnection = async (req, res) => {
  try {
    await service.testConnection(req);
    res.json({ status: 'success', message: 'FTP connection successful' });
  } catch (e) {
    res.status(502).json({ status: 'error', message: e.message });
  }
};
