/**
 * LensFrame - 摄影海报生成器
 * 渲染进程 - UI 交互逻辑
 */

import './index.css';

// 状态管理
const state = {
  files: [],
  selectedIndex: -1,
  currentPoster: null,
  isProcessing: false
};

// DOM 元素
const elements = {
  fileList: document.getElementById('fileList'),
  addFilesBtn: document.getElementById('addFilesBtn'),
  generateBtn: document.getElementById('generateBtn'),
  batchBtn: document.getElementById('batchBtn'),
  previewContainer: document.getElementById('previewContainer'),
  previewImage: document.getElementById('previewImage'),
  exifPanel: document.getElementById('exifPanel'),
  dropOverlay: document.getElementById('dropOverlay'),
  progressModal: document.getElementById('progressModal'),
  progressFill: document.getElementById('progressFill'),
  progressText: document.getElementById('progressText')
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  initDragDrop();
});

function initEventListeners() {
  elements.addFilesBtn.addEventListener('click', handleAddFiles);
  elements.generateBtn.addEventListener('click', handleGenerate);
  elements.batchBtn.addEventListener('click', handleBatchExport);

  // 模板切换 - 使用防抖
  let debounceTimer = null;
  document.querySelectorAll('input[name="template"]').forEach(input => {
    input.addEventListener('change', () => {
      if (state.selectedIndex >= 0 && !state.isProcessing) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          updatePreview();
        }, 300);
      }
    });
  });

  // Logo 大小滑块
  const logoSizeSlider = document.getElementById('logoSize');
  const logoSizeValue = document.getElementById('logoSizeValue');
  if (logoSizeSlider) {
    logoSizeSlider.addEventListener('input', () => {
      logoSizeValue.textContent = `${logoSizeSlider.value}%`;
    });
    logoSizeSlider.addEventListener('change', () => {
      if (state.selectedIndex >= 0 && !state.isProcessing) {
        updatePreview();
      }
    });
  }

  // Logo 位置滑块
  const logoPositionSlider = document.getElementById('logoPosition');
  const logoPositionValue = document.getElementById('logoPositionValue');
  if (logoPositionSlider) {
    logoPositionSlider.addEventListener('input', () => {
      logoPositionValue.textContent = `${logoPositionSlider.value}%`;
    });
    logoPositionSlider.addEventListener('change', () => {
      if (state.selectedIndex >= 0 && !state.isProcessing) {
        updatePreview();
      }
    });
  }
}

function initDragDrop() {
  const app = document.querySelector('.app');
  let dragCounter = 0;

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    app.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); });
  });

  app.addEventListener('dragenter', () => {
    dragCounter++;
    elements.dropOverlay.classList.add('active');
  });

  app.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      elements.dropOverlay.classList.remove('active');
    }
  });

  app.addEventListener('drop', async (e) => {
    dragCounter = 0;
    elements.dropOverlay.classList.remove('active');
    const files = Array.from(e.dataTransfer.files);
    const imagePaths = [];
    for (const file of files) {
      if (/\.(jpe?g|png|tiff?|webp)$/i.test(file.name)) {
        try {
          // 使用 preload 暴露的方法获取文件路径
          const filePath = window.lensframe.getPathForFile(file);
          if (filePath) {
            imagePaths.push(filePath);
          }
        } catch (err) {
          console.error('获取文件路径失败:', err);
        }
      }
    }
    if (imagePaths.length > 0) await addFiles(imagePaths);
  });
}

async function handleAddFiles() {
  const filePaths = await window.lensframe.selectFiles();
  if (filePaths && filePaths.length > 0) await addFiles(filePaths);
}

async function addFiles(filePaths) {
  for (const filePath of filePaths) {
    if (state.files.some(f => f.path === filePath)) continue;

    try {
      const [exif, imageInfo] = await Promise.all([
        window.lensframe.readExif(filePath),
        window.lensframe.loadImage(filePath)
      ]);

      const filename = filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');

      state.files.push({
        path: filePath,
        name: filename,
        exif: exif,
        thumbnail: imageInfo.base64,
        width: imageInfo.width,
        height: imageInfo.height
      });
    } catch (error) {
      console.error('添加文件失败:', filePath, error);
    }
  }

  renderFileList();
  updateButtons();
  if (state.files.length > 0 && state.selectedIndex < 0) selectFile(0);
}

function renderFileList() {
  if (state.files.length === 0) {
    elements.fileList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 4v12m0 0l-4-4m4 4l4-4"/>
        </svg>
        <p>点击添加或拖拽图片</p>
      </div>`;
    return;
  }

  elements.fileList.innerHTML = state.files.map((file, index) => `
    <div class="file-item ${index === state.selectedIndex ? 'active' : ''}" data-index="${index}">
      <img class="thumbnail" src="${file.thumbnail}" alt="${file.name}">
      <div class="info">
        <div class="name">${file.name}</div>
        <div class="meta">${file.width} × ${file.height}</div>
      </div>
      <button class="remove" data-index="${index}" title="移除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  `).join('');

  elements.fileList.querySelectorAll('.file-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (!e.target.closest('.remove')) selectFile(parseInt(item.dataset.index));
    });
  });

  elements.fileList.querySelectorAll('.remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFile(parseInt(btn.dataset.index));
    });
  });
}

async function selectFile(index) {
  if (index < 0 || index >= state.files.length) return;
  if (state.isProcessing) return;

  state.selectedIndex = index;
  renderFileList();
  updateExifPanel();
  await updatePreview();
}

function removeFile(index) {
  if (state.isProcessing) return;

  state.files.splice(index, 1);
  if (state.selectedIndex >= state.files.length) state.selectedIndex = state.files.length - 1;
  renderFileList();
  updateButtons();

  if (state.selectedIndex >= 0) {
    selectFile(state.selectedIndex);
  } else {
    elements.previewImage.style.display = 'none';
    const placeholder = elements.previewContainer.querySelector('.preview-placeholder');
    if (placeholder) placeholder.style.display = 'flex';
    elements.exifPanel.style.display = 'none';
    state.currentPoster = null;
  }
}

function updateExifPanel() {
  const file = state.files[state.selectedIndex];
  if (!file) { elements.exifPanel.style.display = 'none'; return; }

  const exif = file.exif;
  document.getElementById('exifCamera').textContent = exif.cameraModel || '-';
  document.getElementById('exifLens').textContent = exif.lensModel || '-';
  document.getElementById('exifFocal').textContent = exif.focalLength || '-';
  document.getElementById('exifAperture').textContent = exif.aperture || '-';
  document.getElementById('exifShutter').textContent = exif.shutterSpeed || '-';
  document.getElementById('exifISO').textContent = exif.iso || '-';
  elements.exifPanel.style.display = 'block';
}

async function updatePreview() {
  const file = state.files[state.selectedIndex];
  if (!file) return;

  if (state.isProcessing) return;
  state.isProcessing = true;

  const template = document.querySelector('input[name="template"]:checked').value;

  try {
    let posterBuffer;
    const logoScale = (document.getElementById('logoSize')?.value || 100) / 100;
    const logoPosition = (document.getElementById('logoPosition')?.value || 50) / 100;
    if (template === 'blur') {
      posterBuffer = await window.lensframe.generateBlurPoster(file.path, file.exif, true, 'high', logoScale, logoPosition, 'png');
    } else {
      posterBuffer = await window.lensframe.generateClassicPoster(file.path, file.exif, true, 'png');
    }

    state.currentPoster = posterBuffer;
    const base64 = bufferToBase64(posterBuffer);
    elements.previewImage.src = `data:image/png;base64,${base64}`;
    elements.previewImage.style.display = 'block';

    const placeholder = elements.previewContainer.querySelector('.preview-placeholder');
    if (placeholder) placeholder.style.display = 'none';
  } catch (error) {
    console.error('生成预览失败:', error);
    showNotification('生成预览失败: ' + error.message, 'error');
  } finally {
    state.isProcessing = false;
    updateButtons();
  }
}

function bufferToBase64(buffer) {
  if (buffer instanceof Uint8Array || buffer instanceof ArrayBuffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  return buffer.toString('base64');
}

async function handleGenerate() {
  if (state.selectedIndex < 0) {
    showNotification('请先选择一张图片', 'error');
    return;
  }

  if (state.isProcessing) {
    showNotification('正在处理中，请稍候', 'error');
    return;
  }

  const file = state.files[state.selectedIndex];
  const template = document.querySelector('input[name="template"]:checked').value;
  const format = document.querySelector('input[name="format"]:checked').value;
  const quality = document.querySelector('input[name="quality"]:checked')?.value || 'high';
  const ext = format === 'jpg' ? 'jpg' : 'png';

  const savePath = await window.lensframe.saveFile(
    `${file.name}_poster.${ext}`,
    [{ name: `${ext.toUpperCase()} 图片`, extensions: [ext] }]
  );

  if (savePath) {
    state.isProcessing = true;
    showProgress(true);
    const qualityText = quality === 'fast' ? '快速导出' : '原画质';
    updateProgress(30, `正在生成${qualityText}海报...`);

    try {
      let posterBuffer;
      const logoScale = (document.getElementById('logoSize')?.value || 100) / 100;
      const logoPosition = (document.getElementById('logoPosition')?.value || 50) / 100;
      if (template === 'blur') {
        posterBuffer = await window.lensframe.generateBlurPoster(file.path, file.exif, false, quality, logoScale, logoPosition, format);
      } else {
        posterBuffer = await window.lensframe.generateClassicPoster(file.path, file.exif, false, format);
      }

      updateProgress(80, '正在保存文件...');
      await window.lensframe.savePoster(posterBuffer, savePath, format);

      showProgress(false);
      showNotification('海报已保存！', 'success');
    } catch (error) {
      console.error('保存失败:', error);
      showProgress(false);
      showNotification('保存失败: ' + error.message, 'error');
    } finally {
      state.isProcessing = false;
      updateButtons();
    }
  }
}

async function handleBatchExport() {
  if (state.files.length === 0) return;
  if (state.isProcessing) return;

  const saveDir = await window.lensframe.selectDirectory();
  if (!saveDir) return;

  const template = document.querySelector('input[name="template"]:checked').value;
  const format = document.querySelector('input[name="format"]:checked').value;
  const quality = document.querySelector('input[name="quality"]:checked')?.value || 'high';
  const ext = format === 'jpg' ? 'jpg' : 'png';

  state.isProcessing = true;
  showProgress(true);

  try {
    for (let i = 0; i < state.files.length; i++) {
      const file = state.files[i];
      const qualityText = quality === 'fast' ? '快速' : '原画质';
      updateProgress((i + 1) / state.files.length * 100, `${qualityText}处理 (${i + 1}/${state.files.length}): ${file.name}`);

      let posterBuffer;
      const logoScale = (document.getElementById('logoSize')?.value || 100) / 100;
      const logoPosition = (document.getElementById('logoPosition')?.value || 50) / 100;
      if (template === 'blur') {
        posterBuffer = await window.lensframe.generateBlurPoster(file.path, file.exif, false, quality, logoScale, logoPosition, format);
      } else {
        posterBuffer = await window.lensframe.generateClassicPoster(file.path, file.exif, false, format);
      }

      // 使用 / 作为路径分隔符，Windows 和 macOS/Linux 均兼容
      const savePath = `${saveDir}/${file.name}_poster.${ext}`;
      await window.lensframe.savePoster(posterBuffer, savePath, format);
    }

    showProgress(false);
    showNotification(`已导出 ${state.files.length} 张海报！`, 'success');
  } catch (error) {
    console.error('批量导出失败:', error);
    showProgress(false);
    showNotification('导出失败: ' + error.message, 'error');
  } finally {
    state.isProcessing = false;
    updateButtons();
  }
}

function updateButtons() {
  const hasFiles = state.files.length > 0;
  const hasSelection = state.selectedIndex >= 0;
  elements.generateBtn.disabled = !hasSelection || state.isProcessing;
  elements.batchBtn.disabled = !hasFiles || state.isProcessing;
}

function showProgress(show) {
  elements.progressModal.style.display = show ? 'flex' : 'none';
  if (!show) {
    elements.progressFill.style.width = '0%';
    elements.progressText.textContent = '准备中...';
  }
}

function updateProgress(percent, text) {
  elements.progressFill.style.width = `${percent}%`;
  elements.progressText.textContent = text;
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; padding: 16px 24px;
    background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#667eea'};
    color: white; border-radius: 10px; font-weight: 500; z-index: 1001;
    animation: slideIn 0.3s ease; max-width: 400px; word-break: break-word;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// 添加动画
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
`;
document.head.appendChild(style);
