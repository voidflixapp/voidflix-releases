'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    minimize:    () => ipcRenderer.send('window:minimize'),
    maximize:    () => ipcRenderer.send('window:maximize'),
    close:       () => ipcRenderer.send('window:close'),
    onMaximized: (cb) => {
        const fn = (_e, isMax) => cb(isMax);
        ipcRenderer.on('window:maximized', fn);
        return () => ipcRenderer.removeListener('window:maximized', fn);
    },

    // Discord
    discord: {
        watching: (p) => ipcRenderer.send('discord:watching', p),
        idle:     ()  => ipcRenderer.send('discord:idle'),
        clear:    ()  => ipcRenderer.send('discord:clear'),
    },

    // ROMs
    roms: {
        getDefaultRoot: ()                    => ipcRenderer.invoke('roms:getDefaultRoot'),
        getLibrary:     (root)                => ipcRenderer.invoke('roms:getLibrary', root),
        chooseFolder:   ()                    => ipcRenderer.invoke('roms:chooseFolder'),
        readFile:       (root, con, filename) => ipcRenderer.invoke('roms:readFile', root, con, filename),
    },

    isElectron: true,
});
