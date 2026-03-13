const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('lensframe', {
    selectFiles: () => ipcRenderer.invoke('select-files'),
    saveFile: (defaultName, filters) => ipcRenderer.invoke('save-file', { defaultName, filters }),
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    readExif: (filePath) => ipcRenderer.invoke('read-exif', filePath),
    loadImage: (filePath) => ipcRenderer.invoke('load-image', filePath),
    generateClassicPoster: (filePath, exifInfo, isPreview = false, outputFormat = 'png') =>
        ipcRenderer.invoke('generate-classic-poster', filePath, exifInfo, isPreview, outputFormat),
    generateBlurPoster: (filePath, exifInfo, isPreview = false, exportQuality = 'high', logoScale = 1.0, logoPosition = 0.5, outputFormat = 'png') =>
        ipcRenderer.invoke('generate-blur-poster', filePath, exifInfo, isPreview, exportQuality, logoScale, logoPosition, outputFormat),
    savePoster: (buffer, filePath, format) => ipcRenderer.invoke('save-poster', buffer, filePath, format),
    // 用于拖拽文件获取路径
    getPathForFile: (file) => webUtils.getPathForFile(file)
});
