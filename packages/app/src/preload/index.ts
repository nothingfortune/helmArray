// Runs in each window before its page, sandboxed. The only thing it does is hand the page
// `window.helm`; the page never sees `ipcRenderer`.

import { contextBridge, ipcRenderer } from 'electron';
import { createHelmApi } from './api';

contextBridge.exposeInMainWorld('helm', createHelmApi(ipcRenderer));
