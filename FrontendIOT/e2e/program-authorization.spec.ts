import { test, expect } from './fixtures/auth';

/**
 * Screen 10 — supervisor authorisation on program transfer.
 *
 * This gate is a safety control: without it any logged-in user could push
 * G-code to any controller in the company, and a wrong program can crash a
 * spindle. The tests that matter are the negative ones — a send must not
 * get through without a code, and a rejected code must not silently look
 * like a transfer failure the operator would just retry.
 *
 * Everything is mocked so the spec runs without a backend or a real CNC.
 */

const machines = {
  data: [
    { id: 1, machine_serial_no: 'VMC-102-F', ip_address: '192.168.1.101', is_active: true },
    { id: 2, machine_serial_no: 'HMC-014-F', ip_address: '192.168.1.102', is_active: true }
  ],
  total: 2
};

const programs = {
  status: 'success',
  total: 1,
  data: [{
    id: 11, name: 'O1234 Flange Roughing', file_name: 'O1234.nc',
    file_size: 2048, created_at: '2026-09-01T10:00:00.000Z', uploaded_by_name: 'Demo Admin'
  }]
};

const codeIssued = {
  status: 'success',
  data: {
    authorization_id: 77,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    machine_serial: 'VMC-102-F',
    supervisor: { id: 42, username: 'Ravi Kumar', sent_to: 'r***@stm.com' },
    channel: 'EMAIL'
  }
};

/** The batch endpoint reports a rejected code per row, not as an HTTP error. */
const wrongCodeResult = {
  status: 'success',
  data: {
    total: 1, succeeded: 0, failed: 1,
    results: [{
      program_id: 11, program_name: 'O1234 Flange Roughing', machine_id: 1,
      machine_serial: 'VMC-102-F', status: 'APPROVAL_REQUIRED',
      code: 'INVALID_CODE', message: 'Incorrect code. 4 attempts remaining.'
    }]
  }
};

const transferOk = {
  status: 'success',
  message: '1 of 1 transfers completed',
  data: {
    total: 1, succeeded: 1, failed: 0,
    results: [{ program_id: 11, machine_id: 1, status: 'SUCCESS', transfer_id: 900 }]
  }
};

const json = (body: any, status = 200) => ({
  status, contentType: 'application/json', body: JSON.stringify(body)
});

type Handlers = {
  authorization?: (r: any) => any;
  batch?: (r: any) => any;
};

/**
 * One handler dispatching on the URL, rather than a catch-all plus more
 * specific routes: overlapping page.route patterns resolve by registration
 * order, which is easy to get subtly wrong and leaves every unmatched call
 * to 401 against the real API — which logs the stub user out mid-test.
 */
async function mockApi(page: any, handlers: Handlers = {}) {
  await page.route('**/api/**', (route: any) => {
    const url = route.request().url();

    if (url.includes('/programs/authorization/request')) {
      return handlers.authorization
        ? handlers.authorization(route)
        : route.fulfill(json(codeIssued));
    }
    if (url.includes('/programs/transfer-batch')) {
      return handlers.batch ? handlers.batch(route) : route.fulfill(json(transferOk));
    }
    if (url.includes('/programs/transfers'))     return route.fulfill(json({ status: 'success', data: [], total: 0 }));
    if (/\/programs\/machine\/\d+\/status/.test(url)) return route.fulfill(json({ status: 'success', data: { online: true } }));
    if (/\/programs\/machine\/\d+\/files/.test(url))  return route.fulfill(json({ status: 'success', data: [] }));
    if (url.includes('/programs'))               return route.fulfill(json(programs));
    if (url.includes('/machines'))               return route.fulfill(json(machines));
    return route.fulfill(json({ status: 'success', data: [] }));
  });
}

/**
 * Pick a machine and tick the one program in the library.
 *
 * The machine list uses [ngValue], so Angular writes option values as
 * "<index>: <value>" rather than the raw id — selecting by index is what
 * actually works here. Index 0 is the "-- Select machine --" placeholder.
 */
async function selectMachineAndProgram(page: any, machineIndex: number) {
  const select = page.locator('select').first();
  await expect(select.locator('option')).toHaveCount(machines.data.length + 1);
  await select.selectOption({ index: machineIndex });
  await page.locator('tbody input[type=checkbox]').first().check();
}

test.describe('Program transfer — supervisor authorisation', () => {
  test('a send cannot reach the controller without a supervisor code', async ({ authedPage: page }) => {
    let batchCalls = 0;
    await mockApi(page, {
      batch: (r) => { batchCalls += 1; return r.fulfill(json(transferOk)); }
    });

    await page.goto('/programs');
    await selectMachineAndProgram(page, 1);
    await page.getByRole('button', { name: /^Send/ }).click();

    // The modal must appear, and nothing may have been transferred yet.
    await expect(page.getByRole('heading', { name: 'Supervisor Authorisation' })).toBeVisible();
    expect(batchCalls).toBe(0);
  });

  test('names the supervisor and masks their address', async ({ authedPage: page }) => {
    await mockApi(page);

    await page.goto('/programs');
    await selectMachineAndProgram(page, 1);
    await page.getByRole('button', { name: /^Send/ }).click();

    await expect(page.getByText('Ravi Kumar')).toBeVisible();
    // Enough to know who to ask, not enough to harvest the address.
    await expect(page.getByText('r***@stm.com')).toBeVisible();
  });

  test('a wrong code keeps the prompt open and says how many tries are left', async ({ authedPage: page }) => {
    await mockApi(page, { batch: (r) => r.fulfill(json(wrongCodeResult)) });

    await page.goto('/programs');
    await selectMachineAndProgram(page, 1);
    await page.getByRole('button', { name: /^Send/ }).click();

    await page.locator('#authCode').fill('000000');
    await page.getByRole('button', { name: /Authorise & Send/ }).click();

    // A rejected code must not read as a transfer failure the operator retries.
    await expect(page.getByText('Incorrect code. 4 attempts remaining.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Supervisor Authorisation' })).toBeVisible();
    await expect(page.locator('#authCode')).toHaveValue('');
  });

  test('the right code sends the transfer and carries the code with it', async ({ authedPage: page }) => {
    let sentBody: any = null;
    await mockApi(page, {
      batch: (r) => { sentBody = r.request().postDataJSON(); return r.fulfill(json(transferOk)); }
    });

    await page.goto('/programs');
    await selectMachineAndProgram(page, 1);
    await page.getByRole('button', { name: /^Send/ }).click();

    await page.locator('#authCode').fill('123456');
    await page.getByRole('button', { name: /Authorise & Send/ }).click();

    await expect(page.getByRole('heading', { name: 'Supervisor Authorisation' })).toBeHidden();
    expect(sentBody).toMatchObject({ authorization_id: 77, authorization_code: '123456' });
  });

  test('an unsupervised machine is refused with an instruction, not a dead end', async ({ authedPage: page }) => {
    await mockApi(page, {
      authorization: (r) => r.fulfill(json({
        status: 'error',
        code: 'NO_SUPERVISOR_ASSIGNED',
        message: 'No supervisor is assigned to HMC-014-F. An administrator must assign one before programs can be transferred to it.'
      }, 403))
    });

    await page.goto('/programs');
    await selectMachineAndProgram(page, 2);
    await page.getByRole('button', { name: /^Send/ }).click();

    // Nobody can authorise this machine, so leaving the code prompt open
    // would strand the operator with no way forward.
    await expect(page.getByText(/administrator must assign one/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Supervisor Authorisation' })).toBeHidden();
  });
});
