const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
// electron-is-dev は ES Module なのでrequireでは使えないため、自前で判定する
const isDev =
  process.env.NODE_ENV === "development" ||
  process.env.DEBUG_PROD === "true" ||
  !app.isPackaged;

// 設定ファイルのパスを定義
const userDataPath = app.getPath("userData");
const configPath = path.join(userDataPath, "config.json");

// 設定を読み込む関数
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error loading config:", error);
  }
  return {};
}

// 設定を保存する関数
function saveConfig(data) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Error saving config:", error);
  }
}

// 設定を初期化
const config = loadConfig();

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    title: "ファイル名一括変更",
    icon: path.join(__dirname, "../../build/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true, // メニューバーを自動的に隠す
  });

  // メニューバーを完全に無効化
  mainWindow.setMenu(null);

  // Load the index.html file
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  // 開発者ツールは必要な時のみ手動で開く
  // if (isDev) {
  //   mainWindow.webContents.openDevTools();
  // }

  // Set window title
  mainWindow.on("page-title-updated", (e) => {
    e.preventDefault();
  });
}

// Create main window when Electron has finished initialization
app.whenReady().then(() => {
  createWindow();

  app.on("activate", function () {
    // On macOS it's common to re-create a window when the dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS
app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

// 設定を取得するIPC
ipcMain.handle("get-config", (event, key) => {
  return config[key];
});

// 設定を保存するIPC
ipcMain.handle("set-config", (event, key, value) => {
  config[key] = value;
  saveConfig(config);
  return true;
});

/**
 * ファイル名変更処理を最適化
 * - 重複チェックは送信されたデータでレンダラープロセスですでに行っている
 * - 非同期処理を使用してパフォーマンスを向上
 * - プログレス通知を実装
 */
ipcMain.handle("rename-files", async (event, { filePaths, renamedNames }) => {
  try {
    // 既存ファイルの確認
    const existingFiles = [];
    for (let i = 0; i < filePaths.length; i++) {
      const srcPath = filePaths[i];
      const fileName = renamedNames[i];
      const dirName = path.dirname(srcPath);
      const destPath = path.join(dirName, fileName);

      if (srcPath !== destPath && fs.existsSync(destPath)) {
        existingFiles.push(fileName);
      }
    }

    if (existingFiles.length > 0) {
      return {
        success: false,
        error: `同名のファイルが存在します: ${existingFiles
          .slice(0, 3)
          .join(", ")}${
          existingFiles.length > 3 ? ` 他 ${existingFiles.length - 3} 件` : ""
        }`,
      };
    }

    // リネーム処理の実行
    const totalFiles = filePaths.length;
    let processedFiles = 0;

    // ファイルを小さなバッチに分割して処理
    const batchSize = 50;
    for (let i = 0; i < filePaths.length; i += batchSize) {
      const batch = filePaths.slice(i, i + batchSize);
      const batchNames = renamedNames.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (srcPath, index) => {
          const fileName = batchNames[index];
          const dirName = path.dirname(srcPath);
          const destPath = path.join(dirName, fileName);

          try {
            await fs.promises.rename(srcPath, destPath);
            processedFiles++;

            // プログレス通知
            event.sender.send("rename-progress", {
              current: processedFiles,
              total: totalFiles,
              percentage: Math.round((processedFiles / totalFiles) * 100),
              currentFile: fileName,
            });
          } catch (error) {
            console.error(`Error renaming ${srcPath}:`, error);
            throw error;
          }
        })
      );

      // 各バッチ処理後に少し待機してUIの更新を許可
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    return { success: true };
  } catch (error) {
    console.error("Rename operation failed:", error);
    return { success: false, error: error.message };
  }
});

// Handle dialog to select files
ipcMain.handle("select-files", async () => {
  // Get supported extensions for file dialog filters
  const supportedExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".tga",
    ".tif",
    ".tiff",
    ".psd",
    ".mp4",
    ".mov",
    ".avi",
    ".mkv",
    ".webm",
    ".wmv",
    ".flv",
    ".f4v",
    ".m4v",
    ".ogg",
    ".mp3",
    ".wav",
    ".webp",
    ".svg",
  ];

  // Create filter groups
  const filters = [
    {
      name: "All Supported Files",
      extensions: supportedExtensions.map((ext) => ext.substring(1)),
    },
    {
      name: "Images",
      extensions: [
        "jpg",
        "jpeg",
        "png",
        "gif",
        "bmp",
        "tga",
        "tif",
        "tiff",
        "psd",
        "webp",
        "svg",
      ],
    },
    {
      name: "Videos",
      extensions: [
        "mp4",
        "mov",
        "avi",
        "mkv",
        "webm",
        "wmv",
        "flv",
        "f4v",
        "m4v",
      ],
    },
    {
      name: "Audio",
      extensions: ["ogg", "mp3", "wav"],
    },
  ];

  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: filters,
  });

  if (canceled) {
    return [];
  }
  return filePaths;
});

// Get supported file extensions
ipcMain.handle("get-supported-extensions", () => {
  return [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".tga",
    ".tif",
    ".tiff",
    ".psd",
    ".mp4",
    ".mov",
    ".avi",
    ".mkv",
    ".webm",
    ".wmv",
    ".flv",
    ".f4v",
    ".m4v",
    ".ogg",
    ".mp3",
    ".wav",
    ".webp",
    ".svg",
  ];
});
