const { app, BrowserWindow, protocol, net, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true } }
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
    autoHideMenuBar: true,
    title: 'IOT Dashboard',
    show: false,
  });

  win.once('ready-to-show', () => win.show());

  // Open external links in the system browser, not in Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.loadURL('app://localhost/');
}

app.whenReady().then(() => {
  const distPath = path.join(app.getAppPath(), 'dist', 'FrontendIOT', 'browser');

  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let filePath = url.pathname;

    if (filePath === '/') filePath = '/index.html';

    const fullPath = path.join(distPath, filePath);

    return net.fetch(pathToFileURL(fullPath).toString()).catch(() =>
      // Fall back to index.html so Angular's router handles the path
      net.fetch(pathToFileURL(path.join(distPath, 'index.html')).toString())
    );
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
