const { contextBridge, ipcRenderer } = require("electron");

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("api", {
  // File operations
  renameFiles: async (filesToRename, mode, options) => {
    return await ipcRenderer.invoke(
      "rename-files",
      filesToRename,
      mode,
      options
    );
  },
  selectFiles: () => {
    return ipcRenderer.invoke("select-files");
  },
  getSupportedExtensions: () => {
    return ipcRenderer.invoke("get-supported-extensions");
  },
  getFolderItems: (folderPath) => {
    return ipcRenderer.invoke("get-folder-items", folderPath);
  },
  isDirectory: (itemPath) => {
    return ipcRenderer.invoke("is-directory", itemPath);
  },

  // Config operations
  getConfig: (key) => {
    return ipcRenderer.invoke("get-config", key);
  },
  setConfig: (key, value) => {
    return ipcRenderer.invoke("set-config", key, value);
  },

  // Detect if a file is being dragged over the window
  handleDragOver: (callback) => {
    const dragOverListener = (event) => {
      event.preventDefault();
      event.stopPropagation();
      callback(event);
    };
    document.addEventListener("dragover", dragOverListener);
    return () => document.removeEventListener("dragover", dragOverListener);
  },

  // Detect when files are dropped onto the window
  handleDrop: (callback) => {
    const dropListener = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const files = Array.from(event.dataTransfer.files).map(
        (file) => file.path
      );
      callback(files);
    };
    document.addEventListener("drop", dropListener);
    return () => document.removeEventListener("drop", dropListener);
  },

  // プログレス通知の受信
  onRenameProgress: (callback) => {
    ipcRenderer.on("rename-progress", (event, progress) => {
      callback(progress);
    });
  },

  // プログレス通知の購読解除
  removeRenameProgress: (callback) => {
    ipcRenderer.removeListener("rename-progress", callback);
  },
});
