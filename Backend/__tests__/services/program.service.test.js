/*
 * Unit tests for programs/program.service covering the full transfer flow
 * with a mocked FTP client (no real CNC machine needed):
 *  - createProgram: rejects without a file, inserts with metadata
 *  - transferProgram: SUCCESS path updates the log row
 *  - transferProgram: FTP failure writes error_message + status FAILED (502)
 *  - transferProgram: missing program / machine → error
 *  - deleteProgram: not found → error
 *  - testConnection: blank password falls back to stored one (write-only)
 *  - cleanupStuckTransfers: marks stale PENDING rows FAILED
 */

jest.mock('../../src/db', () => require('../helpers/mockDb').mockDb);
jest.mock('../../src/programs/program.transfer', () => ({
  sendProgramToMachine: jest.fn(),
  testMachineConnection: jest.fn()
}));

const { mockDb, resetDb } = require('../helpers/mockDb');
const { sendProgramToMachine, testMachineConnection } = require('../../src/programs/program.transfer');
const svc = require('../../src/programs/program.service');

const user = { id: 7, company_id: 3 };

beforeEach(() => {
  resetDb();
  sendProgramToMachine.mockReset();
  testMachineConnection.mockReset();
});

describe('program.service.createProgram', () => {
  test('throws when no file is uploaded', async () => {
    await expect(svc.createProgram({ user, body: {}, file: undefined }))
      .rejects.toThrow(/no program file/i);
  });

  test('inserts program with name, size and uploader', async () => {
    const file = { originalname: 'O1234.nc', buffer: Buffer.from('G0 X0 Y0'), size: 8 };
    mockDb.queueResponse({
      rows: [{ id: 1, name: 'Flange Roughing', file_name: 'O1234.nc', file_size: 8 }],
      rowCount: 1
    });

    const result = await svc.createProgram({
      user, file, body: { name: 'Flange Roughing', description: 'op10' }
    });

    expect(result.id).toBe(1);
    const insert = mockDb.calls()[0];
    expect(insert.text).toMatch(/INSERT INTO programs/i);
    expect(insert.params).toEqual([3, 'Flange Roughing', 'O1234.nc', file.buffer, 8, 'op10', 7]);
  });

  test('falls back to file name when no display name given', async () => {
    const file = { originalname: 'O55.prg', buffer: Buffer.from('M30'), size: 3 };
    mockDb.queueResponse({ rows: [{ id: 2 }], rowCount: 1 });

    await svc.createProgram({ user, file, body: {} });

    expect(mockDb.calls()[0].params[1]).toBe('O55.prg');
  });
});

describe('program.service.transferProgram', () => {
  const req = { user, params: { id: '10', machineId: '20' } };

  const programRow = {
    id: 10, name: 'Flange Roughing', file_name: 'O1234.nc',
    content: Buffer.from('G0 X0')
  };
  const machineRow = {
    id: 20, machine_serial_no: 'VMC-01', ip_address: '192.168.1.101',
    ftp_port: 21, ftp_user: 'cnc', ftp_pass: 'secret', ftp_dir: '/PROGRAM'
  };

  test('SUCCESS: uploads via FTP and marks the log row SUCCESS', async () => {
    mockDb.queueResponse(
      { rows: [programRow], rowCount: 1 },        // program lookup
      { rows: [machineRow], rowCount: 1 },        // machine lookup
      { rows: [{ id: 99 }], rowCount: 1 },        // insert PENDING log
      { rows: [], rowCount: 1 }                   // update SUCCESS
    );
    sendProgramToMachine.mockResolvedValue();

    const result = await svc.transferProgram(req);

    expect(result).toEqual({ transfer_id: 99, status: 'SUCCESS' });
    expect(sendProgramToMachine).toHaveBeenCalledWith(machineRow, programRow.content, 'O1234.nc');

    const update = mockDb.calls()[3];
    expect(update.text).toMatch(/SET status = 'SUCCESS'/);
    expect(update.params).toEqual([99]);
  });

  test('FAILED: FTP error is saved to error_message and rethrown as 502', async () => {
    mockDb.queueResponse(
      { rows: [programRow], rowCount: 1 },
      { rows: [machineRow], rowCount: 1 },
      { rows: [{ id: 100 }], rowCount: 1 },       // insert PENDING log
      { rows: [], rowCount: 1 }                   // update FAILED
    );
    sendProgramToMachine.mockRejectedValue(new Error('connect ETIMEDOUT 192.168.1.101:21'));

    await expect(svc.transferProgram(req)).rejects.toMatchObject({
      status: 502,
      message: /Transfer failed: connect ETIMEDOUT/
    });

    const update = mockDb.calls()[3];
    expect(update.text).toMatch(/SET status = 'FAILED'/);
    expect(update.params).toEqual([100, 'connect ETIMEDOUT 192.168.1.101:21']);
  });

  test('throws when program not found', async () => {
    mockDb.queueResponse(
      { rows: [], rowCount: 0 },                  // program missing
      { rows: [machineRow], rowCount: 1 }
    );

    await expect(svc.transferProgram(req)).rejects.toThrow(/program not found/i);
    expect(sendProgramToMachine).not.toHaveBeenCalled();
  });

  test('throws when machine not found', async () => {
    mockDb.queueResponse(
      { rows: [programRow], rowCount: 1 },
      { rows: [], rowCount: 0 }                   // machine missing
    );

    await expect(svc.transferProgram(req)).rejects.toThrow(/machine not found/i);
    expect(sendProgramToMachine).not.toHaveBeenCalled();
  });
});

describe('program.service.deleteProgram', () => {
  test('throws when program does not belong to company', async () => {
    mockDb.queueResponse({ rows: [], rowCount: 0 });
    await expect(svc.deleteProgram({ user, params: { id: '5' } }))
      .rejects.toThrow(/not found or access denied/i);
  });

  test('soft-deletes the program', async () => {
    mockDb.queueResponse({ rows: [{ id: 5 }], rowCount: 1 });
    await svc.deleteProgram({ user, params: { id: '5' } });
    expect(mockDb.calls()[0].text).toMatch(/SET is_active = false/);
  });
});

describe('program.service.testConnection', () => {
  test('blank password falls back to the stored one (write-only password)', async () => {
    mockDb.queueResponse({
      rows: [{ ip_address: '192.168.1.101', ftp_port: 21, ftp_user: 'cnc', ftp_pass: 'stored-secret' }],
      rowCount: 1
    });
    testMachineConnection.mockResolvedValue();

    await svc.testConnection({
      user,
      body: { machine_id: 20, ip_address: '192.168.1.101', ftp_user: 'cnc', ftp_pass: '' }
    });

    expect(testMachineConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ftp_pass: 'stored-secret' })
    );
  });

  test('form values override stored ones when provided', async () => {
    mockDb.queueResponse({
      rows: [{ ip_address: '10.0.0.1', ftp_port: 21, ftp_user: 'old', ftp_pass: 'old-pass' }],
      rowCount: 1
    });
    testMachineConnection.mockResolvedValue();

    await svc.testConnection({
      user,
      body: { machine_id: 20, ip_address: '192.168.1.200', ftp_user: 'new', ftp_pass: 'new-pass' }
    });

    expect(testMachineConnection).toHaveBeenCalledWith({
      ip_address: '192.168.1.200', ftp_port: 21, ftp_user: 'new', ftp_pass: 'new-pass'
    });
  });

  test('works without machine_id (new machine, nothing saved yet)', async () => {
    testMachineConnection.mockResolvedValue();

    await svc.testConnection({
      user,
      body: { ip_address: '192.168.1.50', ftp_port: 21, ftp_user: 'cnc', ftp_pass: 'pw' }
    });

    expect(mockDb.calls()).toHaveLength(0);   // no DB lookup needed
    expect(testMachineConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ip_address: '192.168.1.50' })
    );
  });

  test('throws when machine_id given but machine not found', async () => {
    mockDb.queueResponse({ rows: [], rowCount: 0 });
    await expect(svc.testConnection({ user, body: { machine_id: 999 } }))
      .rejects.toThrow(/machine not found/i);
  });
});

describe('program.service.cleanupStuckTransfers', () => {
  test('marks stale PENDING rows as FAILED and returns the count', async () => {
    mockDb.queueResponse({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 });

    const fixed = await svc.cleanupStuckTransfers();

    expect(fixed).toBe(2);
    const q = mockDb.calls()[0].text;
    expect(q).toMatch(/SET status = 'FAILED'/);
    expect(q).toMatch(/status = 'PENDING'/);
    expect(q).toMatch(/INTERVAL '5 minutes'/);
  });
});
