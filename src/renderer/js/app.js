/**
 * Multi File Rename
 * Electron application for batch renaming files with customizable templates
 */

document.addEventListener("DOMContentLoaded", () => {
  const app = new RenameApp();
  app.init();
});

class RenameApp {
  constructor() {
    // File list and selection
    this.fileList = [];
    this.selectedIndices = new Set();
    this.supportedExtensions = [];

    // File list elements
    this.dropZone = document.getElementById("drop-zone");
    this.fileListEl = document.getElementById("file-list");

    // Mode and options
    this.currentMode = "serial_only";
    this.droppedFolderPath = null;
    this.startNumber = 1;
    this.template = "{filename}_{date:%Y%m%d}_{num}";
    this.sortStates = { original: true, converted: true };

    // UI elements
    this.templateInput = document.getElementById("template-input");
    this.startNumberInput = document.getElementById("start-number");
    this.customOptions = document.getElementById("custom-options");

    // Buttons
    this.serialOnlyBtn = document.getElementById("serial-only-btn");
    this.serialPrefixBtn = document.getElementById("serial-prefix-btn");
    this.serialSuffixBtn = document.getElementById("serial-suffix-btn");
    this.customBtn = document.getElementById("custom-btn");
    this.folderRenameBtn = document.getElementById("folder-rename-btn");
    this.selectFilesBtn = document.getElementById("select-files-btn");
    this.clearBtn = document.getElementById("clear-btn");
    this.renameBtn = document.getElementById("rename-btn");
    this.resetTemplateBtn = document.getElementById("reset-template-btn");

    // Progress modal elements
    this.progressModal = document.getElementById("progress-modal");
    this.progressBar = document.getElementById("progress-bar");
    this.progressText = document.getElementById("progress-text");
    this.progressDetails = document.getElementById("progress-details");

    // Progress tracking
    this.progressCallback = null;

    // Notification elements
    this.notification = document.getElementById("notification");
    this.notificationTimer = null;
  }

  async init() {
    // Get supported extensions
    this.supportedExtensions = await window.api.getSupportedExtensions();

    // Set up event listeners
    this.setupEventListeners();

    // Set up progress listener
    this.setupProgressListener();

    // Initialize UI state
    this.updateUI();

    // Load saved settings
    await this.loadSettings();
  }

  setupEventListeners() {
    // Add file drag and drop listeners
    this.setupDragAndDrop();

    // File selection button
    this.selectFilesBtn.addEventListener("click", () => this.selectFiles());

    // Clear button
    this.clearBtn.addEventListener("click", () => this.clearList());

    // Rename button
    this.renameBtn.addEventListener("click", () => this.renameFiles());

    // Mode buttons
    this.serialOnlyBtn.addEventListener("click", () =>
      this.setMode("serial_only")
    );
    this.serialPrefixBtn.addEventListener("click", () =>
      this.setMode("serial_prefix")
    );
    this.serialSuffixBtn.addEventListener("click", () =>
      this.setMode("serial_suffix")
    );
    this.customBtn.addEventListener("click", () => this.setMode("custom"));
    this.folderRenameBtn.addEventListener("click", () =>
      this.setMode("folder_rename")
    );

    // Reset template
    this.resetTemplateBtn.addEventListener("click", () => {
      this.templateInput.value = "{filename}_{date:%Y%m%d}_{num}";
      this.template = this.templateInput.value;
      this.updatePreview();
    });

    // Template input
    this.templateInput.addEventListener("input", () => {
      this.template = this.templateInput.value;
      this.updatePreview();
    });

    // Start number input
    this.startNumberInput.addEventListener("input", () => {
      this.startNumber = parseInt(this.startNumberInput.value, 10) || 1;
      this.updatePreview();
    });

    // Sort columns
    document
      .querySelector(".column.original")
      .addEventListener("click", () => this.sortBy("original"));
    document
      .querySelector(".column.converted")
      .addEventListener("click", () => this.sortBy("converted"));

    // Delete key for selected files
    document.addEventListener("keydown", (e) => {
      if (e.key === "Delete" && this.selectedIndices.size > 0) {
        this.deleteSelectedFiles();
      }
    });
  }

  setupDragAndDrop() {
    // Setup drag over handler
    window.api.handleDragOver(() => {
      this.dropZone.classList.add("drag-over");
    });

    // Setup drop handler
    window.api.handleDrop((filePaths) => {
      this.dropZone.classList.remove("drag-over");
      this.processDroppedFiles(filePaths);
    });

    // Remove drag-over class when leave or end
    this.dropZone.addEventListener("dragleave", () => {
      this.dropZone.classList.remove("drag-over");
    });

    this.dropZone.addEventListener("dragend", () => {
      this.dropZone.classList.remove("drag-over");
    });
  }

  async selectFiles() {
    const filePaths = await window.api.selectFiles();
    if (filePaths && filePaths.length > 0) {
      this.addFiles(filePaths);
    }
  }

  async processDroppedFiles(filePaths) {
    if (this.currentMode === "folder_rename") {
      // フォルダリネームモードの場合、最初のアイテムがフォルダであることを期待
      if (filePaths && filePaths.length > 0) {
        const folderPath = filePaths[0];
        const isDirectory = await window.api.isDirectory(folderPath);
        if (isDirectory) {
          this.droppedFolderPath = folderPath; // ドロップされたフォルダのパスを保存
          const items = await window.api.getFolderItems(folderPath);
          if (items && items.length > 0) {
            this.addFiles(
              items.map((item) => `${folderPath}/${item}`),
              true
            );
          } else {
            this.showNotification("フォルダが空です。", "warning");
          }
        } else {
          this.showNotification(
            "フォルダをドラッグ＆ドロップしてください。",
            "warning"
          );
        }
      }
    } else {
      const filteredPaths = filePaths.filter((path) => {
        const ext = this.getFileExtension(path).toLowerCase();
        return (
          this.supportedExtensions.includes(ext) ||
          this.getFileExtension(path) === ""
        ); // フォルダの場合も許可 (isDirectoryで後ほどフィルタリング)
      });

      // フォルダが選択された場合はその中身を展開 (フォルダリネームモードでない場合)
      const expandedFilePaths = [];
      for (const path of filteredPaths) {
        const isDirectory = await window.api.isDirectory(path);
        if (isDirectory) {
          const items = await window.api.getFolderItems(path);
          if (items) {
            items.forEach((item) => expandedFilePaths.push(`${path}/${item}`));
          }
        } else {
          expandedFilePaths.push(path);
        }
      }

      const validExpandedPaths = expandedFilePaths.filter((path) => {
        const ext = this.getFileExtension(path).toLowerCase();
        return this.supportedExtensions.includes(ext);
      });

      if (validExpandedPaths.length > 0) {
        this.addFiles(validExpandedPaths);
      } else if (
        filePaths.length > 0 &&
        filteredPaths.length === 0 &&
        validExpandedPaths.length === 0
      ) {
        this.showNotification("対応していないファイル形式です。", "warning");
      }
    }
  }

  addFiles(filePaths, isFolderContent = false) {
    // Filter already added files to avoid duplicates
    const existingPaths = new Set(this.fileList.map((f) => f.path));
    const newPaths = filePaths.filter((path) => !existingPaths.has(path));

    if (newPaths.length === 0 && !isFolderContent) return; // フォルダコンテンツの場合は空でもUI更新が必要な場合がある
    if (
      newPaths.length === 0 &&
      isFolderContent &&
      this.fileList.length === 0 &&
      !this.droppedFolderPath
    )
      return;

    // Add new files
    for (const path of newPaths) {
      this.fileList.push({
        path,
        name: this.getFileName(path),
        ext: this.getFileExtension(path),
        originalName: this.getFileName(path), // フォルダリネームモード用に元の名前を保持
      });
    }

    // Sort the list by original filename
    if (!isFolderContent) {
      // フォルダコンテンツの場合はドロップされた順を維持することが多い
      this.sortBy("original");
    }

    // Update UI
    this.updateUI();
  }

  clearList() {
    this.fileList = [];
    this.selectedIndices = new Set();
    this.updateUI();
  }

  deleteSelectedFiles() {
    const selectedIndices = Array.from(this.selectedIndices).sort(
      (a, b) => b - a
    );

    // Remove files from highest index to lowest to avoid index shifting
    for (const index of selectedIndices) {
      this.fileList.splice(index, 1);
    }

    this.selectedIndices = new Set();
    this.updateUI();
  }

  setMode(mode) {
    this.currentMode = mode;

    // Update button active states
    this.serialOnlyBtn.classList.toggle("active", mode === "serial_only");
    this.serialPrefixBtn.classList.toggle("active", mode === "serial_prefix");
    this.serialSuffixBtn.classList.toggle("active", mode === "serial_suffix");
    this.customBtn.classList.toggle("active", mode === "custom");
    this.folderRenameBtn.classList.toggle("active", mode === "folder_rename");

    // Show/hide custom options
    this.customOptions.classList.toggle("hidden", mode !== "custom");

    // Update file list container class
    this.updateFileListContainerClass();

    // Reset dropped folder path if not in folder_rename mode
    if (mode !== "folder_rename") {
      this.droppedFolderPath = null;
    }

    // Update the preview
    this.updatePreview();

    // Save settings
    this.saveSettings();
  }

  // Update file list container class
  updateFileListContainerClass() {
    const fileListContainer = document.querySelector(".file-list-container");
    if (this.currentMode === "custom" || this.currentMode === "folder_rename") {
      fileListContainer.classList.add("with-custom-options");
    } else {
      fileListContainer.classList.remove("with-custom-options");
    }
    // folder_renameモードの場合、カスタムオプション自体は隠す
    if (this.customOptions) {
      this.customOptions.classList.toggle(
        "hidden",
        this.currentMode === "folder_rename" || this.currentMode !== "custom"
      );
    }
  }

  sortBy(column) {
    const ascending = this.sortStates[column];

    if (column === "original") {
      // Sort by original filename
      this.fileList.sort((a, b) => {
        return ascending
          ? this.naturalSort(a.name, b.name)
          : this.naturalSort(b.name, a.name);
      });

      // Update sort indicator
      document.querySelector(".column.original .sort-indicator").textContent =
        ascending ? "↓" : "↑";
      document.querySelector(".column.converted .sort-indicator").textContent =
        "";
    } else if (column === "converted") {
      // Generate preview names for sorting
      const previewNames = this.generatePreviewNames();

      // Create array of [index, previewName] pairs
      const indexedNames = previewNames.map((name, index) => [index, name]);

      // Sort by preview name
      indexedNames.sort((a, b) => {
        return ascending
          ? this.naturalSort(a[1], b[1])
          : this.naturalSort(b[1], a[1]);
      });

      // Reorder the file list based on sorted indices
      const newFileList = [];
      for (const [index] of indexedNames) {
        newFileList.push(this.fileList[index]);
      }
      this.fileList = newFileList;

      // Update sort indicator
      document.querySelector(".column.converted .sort-indicator").textContent =
        ascending ? "↓" : "↑";
      document.querySelector(".column.original .sort-indicator").textContent =
        "";
    }

    // Toggle sort direction for next click
    this.sortStates[column] = !ascending;

    // Update UI
    this.updatePreview();
  }

  naturalSort(a, b) {
    return a.localeCompare(b, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  generatePreviewNames() {
    let seqNum = this.startNumber;
    const date = new Date();
    const folderName = this.droppedFolderPath
      ? this.getFileName(this.droppedFolderPath)
      : "";

    return this.fileList.map((file) => {
      let newNameBase = ""; // ベース名（拡張子なし）
      const originalFileName = file.originalName || file.name;

      switch (this.currentMode) {
        case "serial_only":
          newNameBase = `${String(seqNum++).padStart(3, "0")}`;
          break;
        case "serial_prefix":
          newNameBase = `${String(seqNum++).padStart(
            3,
            "0"
          )}_${originalFileName}`;
          break;
        case "serial_suffix":
          newNameBase = `${originalFileName}_${String(seqNum++).padStart(
            3,
            "0"
          )}`;
          break;
        case "custom":
          newNameBase = this.applyTemplate(
            this.template,
            originalFileName,
            seqNum++,
            date
          );
          break;
        case "folder_rename":
          if (folderName) {
            newNameBase = `${folderName}_${String(seqNum++).padStart(3, "0")}`;
          }
          break;
      }
      return file.ext ? `${newNameBase}.${file.ext}` : newNameBase; // 最後に拡張子を結合、拡張子がない場合はそのまま
    });
  }

  applyTemplate(template, filename, seqNum, date) {
    // Replace {filename}
    let result = template.replace(/\{filename\}/g, filename);

    // Replace {num[:format]}
    result = result.replace(/\{num(?::(.*?))?\}/g, (match, format) => {
      if (format) {
        // Format includes padding, like 001
        if (format.includes("0")) {
          const padding = format.match(/0+/)[0].length;
          return seqNum.toString().padStart(padding, "0");
        }
        // Other formats not supported in this implementation
        return seqNum.toString();
      } else {
        return seqNum.toString();
      }
    });

    // Replace {date[:format]}
    result = result.replace(/\{date(?::(.*?))?\}/g, (match, format) => {
      if (format) {
        // Basic format handling
        let formatted = format;

        // Year
        formatted = formatted.replace(/%Y/g, date.getFullYear());
        // Month (01-12)
        formatted = formatted.replace(
          /%m/g,
          (date.getMonth() + 1).toString().padStart(2, "0")
        );
        // Day (01-31)
        formatted = formatted.replace(
          /%d/g,
          date.getDate().toString().padStart(2, "0")
        );

        // Hour (00-23)
        formatted = formatted.replace(
          /%H/g,
          date.getHours().toString().padStart(2, "0")
        );
        // Minute (00-59)
        formatted = formatted.replace(
          /%M/g,
          date.getMinutes().toString().padStart(2, "0")
        );
        // Second (00-59)
        formatted = formatted.replace(
          /%S/g,
          date.getSeconds().toString().padStart(2, "0")
        );

        return formatted;
      } else {
        // Default date format: YYYYMMDD
        return (
          date.getFullYear() +
          (date.getMonth() + 1).toString().padStart(2, "0") +
          date.getDate().toString().padStart(2, "0")
        );
      }
    });

    return result;
  }

  updateUI() {
    // Show/hide drop message based on whether files are present
    if (this.fileList.length > 0) {
      this.dropZone.classList.add("files-present");
    } else {
      this.dropZone.classList.remove("files-present");
    }

    // Update preview
    this.updatePreview();
  }

  updatePreview() {
    // Clear the list
    this.fileListEl.innerHTML = "";

    // Generate preview names and store them
    this.previewNames = this.generatePreviewNames();

    // Create file rows
    for (let i = 0; i < this.fileList.length; i++) {
      const file = this.fileList[i];
      const previewName = this.previewNames[i];

      const row = document.createElement("div");
      row.className = "file-row";
      row.dataset.index = i;

      if (this.selectedIndices.has(i)) {
        row.classList.add("selected");
      }

      row.addEventListener("click", (e) => this.handleRowClick(i, e));

      const originalCol = document.createElement("div");
      originalCol.className = "file-column original";
      originalCol.textContent = file.name + file.ext;

      const arrowCol = document.createElement("div");
      arrowCol.className = "file-column arrow";
      arrowCol.textContent = "→";

      const convertedCol = document.createElement("div");
      convertedCol.className = "file-column converted";
      convertedCol.textContent = previewName;

      row.appendChild(originalCol);
      row.appendChild(arrowCol);
      row.appendChild(convertedCol);

      this.fileListEl.appendChild(row);
    }
  }

  handleRowClick(index, event) {
    // Handle multi-selection with Ctrl/Shift key
    if (event.ctrlKey) {
      // Toggle selection with Ctrl
      if (this.selectedIndices.has(index)) {
        this.selectedIndices.delete(index);
      } else {
        this.selectedIndices.add(index);
      }
    } else if (event.shiftKey && this.fileList.length > 0) {
      // Range selection with Shift
      const lastSelected = Math.max(...Array.from(this.selectedIndices), -1);

      if (lastSelected !== -1) {
        const start = Math.min(lastSelected, index);
        const end = Math.max(lastSelected, index);

        for (let i = start; i <= end; i++) {
          this.selectedIndices.add(i);
        }
      } else {
        this.selectedIndices.add(index);
      }
    } else {
      // Single selection (clear others)
      this.selectedIndices = new Set([index]);
    }

    this.updatePreview();
  }

  async renameFiles() {
    if (this.fileList.length === 0) {
      this.showNotification("ファイルがリストにありません。", "warning");
      return;
    }

    this.showProgressModal();

    const filesToRename = this.fileList.map((file, index) => ({
      originalPath: file.path,
      originalName: file.name, // リネームAPIには元の完全なファイル名が必要な場合があるため
      newName: this.previewNames[index],
      ext: file.ext,
    }));

    try {
      const results = await window.api.renameFiles(
        filesToRename,
        this.currentMode,
        {
          template: this.template,
          startNumber: this.startNumber,
          droppedFolderPath: this.droppedFolderPath, // フォルダリネームモード用にパスを渡す
        }
      );

      let successCount = 0;
      let failCount = 0;

      // Hide progress modal
      this.hideProgressModal();

      if (results.success) {
        this.showNotification("ファイル名を変更しました", "success");
        this.clearList();
      } else {
        this.showNotification(`エラー: ${results.error}`, "error");
      }
    } catch (error) {
      // Hide progress modal
      this.hideProgressModal();
      this.showNotification(`エラー: ${error.message}`, "error");
    }
  }

  showNotification(message, type = "info") {
    // Clear any existing notification timeout
    if (this.notificationTimer) {
      clearTimeout(this.notificationTimer);
    }

    // Update notification content and type
    this.notification.textContent = message;
    this.notification.className = "notification";
    this.notification.classList.add(type);

    // Show notification
    this.notification.classList.add("show");

    // Hide after 3 seconds
    this.notificationTimer = setTimeout(() => {
      this.notification.classList.remove("show");
    }, 3000);
  }

  // Helper methods for file handling
  getFileName(path) {
    const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const fileNameWithExt = path.substring(lastSlash + 1);
    const lastDot = fileNameWithExt.lastIndexOf(".");
    // 拡張子がないファイルの場合（例: フォルダ名）、またはドットで始まるファイル名の場合
    if (lastDot <= 0) return fileNameWithExt;
    return fileNameWithExt.substring(0, lastDot);
  }

  getFileExtension(path) {
    const fileName = path.substring(
      Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1
    );
    const lastDot = fileName.lastIndexOf(".");
    // ドットで始まるファイル名の場合や、拡張子がない場合は空文字を返す
    return lastDot > 0 ? fileName.substring(lastDot + 1) : "";
  }

  // Progress modal handling
  setupProgressListener() {
    this.progressCallback = (progress) => {
      // Update progress bar
      this.progressBar.style.width = `${progress.percentage}%`;

      // Update progress text
      this.progressText.textContent = `${progress.current} / ${progress.total} ファイル (${progress.percentage}%)`;

      // Update details
      this.progressDetails.textContent = `処理中: ${progress.currentFile}`;
    };

    // Register the progress listener
    window.api.onRenameProgress(this.progressCallback);
  }

  showProgressModal() {
    // Reset progress
    this.progressBar.style.width = "0%";
    this.progressText.textContent = "0 / 0 ファイル (0%)";
    this.progressDetails.textContent = "処理を開始しています...";

    // Show modal
    this.progressModal.classList.add("show");
  }

  hideProgressModal() {
    this.progressModal.classList.remove("show");
  }

  // Save settings to persisted storage
  async saveSettings() {
    try {
      await window.api.setConfig("renameTool", {
        mode: this.currentMode,
        startNumber: this.startNumber,
        template: this.template,
      });
    } catch (error) {
      console.error("Error saving settings:", error);
    }
  }

  // Load saved settings
  async loadSettings() {
    try {
      const settings = await window.api.getConfig("renameTool");
      if (settings) {
        if (settings.mode) {
          this.setMode(settings.mode);
        }

        if (settings.startNumber) {
          this.startNumber = settings.startNumber;
          this.startNumberInput.value = settings.startNumber;
        }

        if (settings.template) {
          this.template = settings.template;
          this.templateInput.value = settings.template;
        }

        this.updatePreview();
      }
    } catch (error) {
      console.error("Error loading settings:", error);
    }
  }
}
