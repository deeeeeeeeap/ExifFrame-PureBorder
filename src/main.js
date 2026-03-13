/**
 * LensFrame - 摄影海报生成器
 * 主进程 - 处理窗口管理、文件操作和图像处理
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const sharp = require('sharp');
const exifr = require('exifr');

// 配置 Sharp 使用多线程（利用多核 CPU）
sharp.concurrency(4);

// Squirrel 启动检查
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow = null;

// 创建主窗口
const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'LensFrame',
    backgroundColor: '#0f0f0f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
};

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ========================================
// 工具函数
// ========================================

/**
 * XML 特殊字符转义（用于 SVG 文本）
 */
function escapeXml(str) {
  if (!str) return '';
  return String(str).replace(/[<>&'"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
  }[c]));
}

async function getRotatedImageBuffer(filePath) {
  const { data, info } = await sharp(filePath, { sequentialRead: true })
    .rotate()
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    width: info.width,
    height: info.height
  };
}

async function resizeImageBuffer(buffer, width, height, maxSize) {
  const originalMax = Math.max(width, height);
  if (originalMax <= maxSize) {
    return { buffer, width, height };
  }

  const scale = maxSize / originalMax;
  const { data, info } = await sharp(buffer, { sequentialRead: true })
    .resize(Math.round(width * scale), Math.round(height * scale))
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    width: info.width,
    height: info.height
  };
}

function encodePoster(pipeline, format = 'png') {
  if (format === 'jpg' || format === 'jpeg') {
    return pipeline.jpeg({ quality: 95 }).toBuffer();
  }

  return pipeline.png().toBuffer();
}

// ========================================
// 品牌检测
// ========================================
function getBrandName(cameraMake) {
  const make = (cameraMake || '').toLowerCase();
  if (make.includes('nikon')) return 'Nikon';
  if (make.includes('canon')) return 'Canon';
  if (make.includes('sony')) return 'SONY';
  if (make.includes('fujifilm') || make.includes('fuji')) return 'FUJIFILM';
  if (make.includes('leica')) return 'Leica';
  if (make.includes('panasonic') || make.includes('lumix')) return 'Panasonic';
  if (make.includes('olympus') || make.includes('om system')) return 'OLYMPUS';
  if (make.includes('hasselblad')) return 'HASSELBLAD';
  if (make.includes('dji')) return 'DJI';
  if (make.includes('apple')) return 'Apple';
  return null;
}

// ========================================
// IPC - 文件操作
// ========================================
ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择图片',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'webp'] }]
  });
  return result.filePaths;
});

ipcMain.handle('save-file', async (event, { defaultName, filters }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '保存海报',
    defaultPath: defaultName,
    filters: filters || [{ name: 'PNG 图片', extensions: ['png'] }, { name: 'JPEG 图片', extensions: ['jpg'] }]
  });
  return result.filePath;
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择保存目录',
    properties: ['openDirectory', 'createDirectory']
  });
  return result.filePaths[0];
});

// ========================================
// IPC - EXIF 读取
// ========================================
ipcMain.handle('read-exif', async (event, filePath) => {
  try {
    const exifData = await exifr.parse(filePath, {
      pick: ['Make', 'Model', 'LensModel', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength']
    });
    if (!exifData) return { cameraMake: '', cameraModel: '', lensModel: '', shutterSpeed: '', aperture: '', iso: '', focalLength: '' };
    return {
      cameraMake: exifData.Make || '',
      cameraModel: exifData.Model || '',
      lensModel: exifData.LensModel || '',
      shutterSpeed: exifData.ExposureTime ? (exifData.ExposureTime >= 1 ? `${exifData.ExposureTime}s` : `1/${Math.round(1 / exifData.ExposureTime)}s`) : '',
      aperture: exifData.FNumber ? `f/${exifData.FNumber}` : '',
      iso: exifData.ISO ? String(exifData.ISO) : '',
      focalLength: exifData.FocalLength ? `${Math.round(exifData.FocalLength)}mm` : ''
    };
  } catch (e) {
    console.warn('EXIF 读取失败:', filePath, e.message);
    return { cameraMake: '', cameraModel: '', lensModel: '', shutterSpeed: '', aperture: '', iso: '', focalLength: '' };
  }
});

// ========================================
// IPC - 图像处理
// ========================================
ipcMain.handle('load-image', async (event, filePath) => {
  try {
    const rotatedImage = await getRotatedImageBuffer(filePath);
    const previewBuffer = await sharp(rotatedImage.buffer, { sequentialRead: true })
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    return {
      width: rotatedImage.width,
      height: rotatedImage.height,
      base64: `data:image/jpeg;base64,${previewBuffer.toString('base64')}`
    };
  } catch (e) {
    throw e;
  }
});

/**
 * 生成经典白底海报（专业留白比例）
 */
ipcMain.handle('generate-classic-poster', async (event, filePath, exifInfo, isPreview = false, outputFormat = 'png') => {
  try {
    let workImage = await getRotatedImageBuffer(filePath);
    if (isPreview) {
      workImage = await resizeImageBuffer(workImage.buffer, workImage.width, workImage.height, 1200);
    }

    const imgWidth = workImage.width;
    const imgHeight = workImage.height;

    // 专业留白比例
    const padding = Math.round(Math.min(imgWidth, imgHeight) * 0.08);
    const infoHeight = Math.round(Math.min(imgWidth, imgHeight) * 0.12);

    const posterWidth = imgWidth + padding * 2;
    const posterHeight = imgHeight + padding * 2 + infoHeight;

    const fontSize = Math.round(infoHeight * 0.26);
    const smallFontSize = Math.round(fontSize * 0.7);

    // 构建参数文本，过滤空值
    const params = [];
    if (exifInfo.focalLength) params.push(exifInfo.focalLength);
    if (exifInfo.aperture) params.push(exifInfo.aperture);
    if (exifInfo.shutterSpeed) params.push(exifInfo.shutterSpeed);
    if (exifInfo.iso) params.push(`ISO ${exifInfo.iso}`);
    const paramsText = escapeXml(params.join('  ·  '));

    const brandName = getBrandName(exifInfo.cameraMake);
    const cameraText = escapeXml(brandName
      ? `${brandName}  ·  ${exifInfo.cameraModel || ''}`
      : (exifInfo.cameraModel || ''));

    const infoSvg = `
      <svg width="${posterWidth}" height="${infoHeight}">
        <text x="${posterWidth / 2}" y="${infoHeight * 0.38}" text-anchor="middle" 
          font-family="Helvetica Neue, Arial, sans-serif" font-size="${fontSize}px" 
          fill="#1a1a1a" font-weight="300" letter-spacing="1">${paramsText}</text>
        <text x="${posterWidth / 2}" y="${infoHeight * 0.72}" text-anchor="middle" 
          font-family="Helvetica Neue, Arial, sans-serif" font-size="${smallFontSize}px" 
          fill="#888888" letter-spacing="1">${cameraText}</text>
      </svg>
    `;

    const poster = await encodePoster(
      sharp({
        create: { width: posterWidth, height: posterHeight, channels: 3, background: { r: 255, g: 255, b: 255 } }
      })
        .composite([
          { input: workImage.buffer, top: padding, left: padding },
          { input: Buffer.from(infoSvg), top: padding + imgHeight + padding, left: 0 }
        ]),
      outputFormat
    );

    // 显式释放 Buffer，帮助 GC 回收内存
    workImage.buffer = null;

    return poster;
  } catch (e) {
    console.error('生成经典海报失败:', e);
    throw e;
  }
});

/**
 * 生成毛玻璃背景海报 - Apple/iOS 风格像素级重构
 * 
 * 核心特性：
 * - 奶油质感毛玻璃背景（饱和度增强 + 重度模糊 + 噪点纹理）
 * - 顶部 Logo 布局（25% 头部区域）
 * - 双层阴影浮动效果（接触阴影 + 环境阴影）
 */

// Logo 文件路径映射（根据实际目录文件）
// 动态获取 Logo 目录：开发模式 vs 打包模式
const getLogoDir = () => {
  if (app.isPackaged) {
    // 打包后：logo 目录在 resources 目录下
    return path.join(process.resourcesPath, 'logo');
  } else {
    // 开发模式：使用项目根目录下的 logo
    return path.join(__dirname, '..', '..', 'logo');
  }
};

// 默认 Logo 映射
const DEFAULT_LOGO_MAP = {
  'nikon': 'Nikon_Logo.svg.png',
  'canon': 'Canon_wordmark.svg.png',
  'sony': 'Sony_logo.svg.png',
  'fujifilm': 'Fujifilm_logo.svg.png',
  'fuji': 'Fujifilm_logo.svg.png',
  'leica': 'Leica_Camera.svg.png',
  'panasonic': 'Panasonic_logo.svg.png',
  'lumix': 'Panasonic_logo.svg.png',
  'olympus': 'Olympus_Corporation_logo.svg.png',
  'om system': 'Olympus_Corporation_logo.svg.png',
  'hasselblad': 'Hasselblad_Logo.svg.png',
  'pentax': 'Pentax_Logo.svg.png'
};

let cachedLogoConfigPath = null;
let cachedLogoMap = null;
const cachedLogoFiles = new Map();

/**
 * 获取 Logo 映射表（优先读取用户配置文件）
 */
function getLogoMap() {
  const logoDir = getLogoDir();
  const configPath = path.join(logoDir, 'logo_config.json');

  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.mappings) {
        // 过滤掉以下划线开头的注释键
        const userMappings = {};
        for (const [key, value] of Object.entries(config.mappings)) {
          if (!key.startsWith('_')) {
            userMappings[key] = value;
          }
        }
        return { ...DEFAULT_LOGO_MAP, ...userMappings };
      }
    }
  } catch (e) {
    console.warn('读取 Logo 配置文件失败:', e.message);
  }

  return DEFAULT_LOGO_MAP;
}

/**
 * 从制造商名称获取 Logo 文件路径
 */
function getLogoPath(cameraMake) {
  if (!cameraMake) return null;
  const make = cameraMake.toLowerCase();
  const logoDir = getLogoDir();
  const logoMap = getLogoMap();

  for (const [keyword, filename] of Object.entries(logoMap)) {
    if (make.includes(keyword)) {
      const logoPath = path.join(logoDir, filename);
      if (fs.existsSync(logoPath)) {
        return logoPath;
      }
    }
  }
  return null;
}

function getLogoMap() {
  const logoDir = getLogoDir();
  const configPath = path.join(logoDir, 'logo_config.json');

  if (cachedLogoMap && cachedLogoConfigPath === configPath) {
    return cachedLogoMap;
  }

  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.mappings) {
        const userMappings = {};
        for (const [key, value] of Object.entries(config.mappings)) {
          if (!key.startsWith('_')) {
            userMappings[key] = value;
          }
        }

        cachedLogoConfigPath = configPath;
        cachedLogoMap = { ...DEFAULT_LOGO_MAP, ...userMappings };
        return cachedLogoMap;
      }
    }
  } catch (e) {
    console.warn('璇诲彇 Logo 閰嶇疆鏂囦欢澶辫触:', e.message);
  }

  cachedLogoConfigPath = configPath;
  cachedLogoMap = DEFAULT_LOGO_MAP;
  return cachedLogoMap;
}

function getLogoPath(cameraMake) {
  if (!cameraMake) return null;
  const make = cameraMake.toLowerCase();
  const logoDir = getLogoDir();
  const logoMap = getLogoMap();

  for (const [keyword, filename] of Object.entries(logoMap)) {
    if (make.includes(keyword)) {
      const logoPath = path.join(logoDir, filename);
      if (cachedLogoFiles.has(logoPath)) {
        return cachedLogoFiles.get(logoPath) ? logoPath : null;
      }

      const exists = fs.existsSync(logoPath);
      cachedLogoFiles.set(logoPath, exists);
      if (exists) {
        return logoPath;
      }
    }
  }

  return null;
}

/**
 * 生成噪点纹理层（模拟胶片颗粒）
 * @param {number} width - 画布宽度
 * @param {number} height - 画布高度
 * @param {number} opacity - 噪点不透明度 (0-1)
 */
function generateNoiseSvg(width, height, opacity = 0.03) {
  // 使用 SVG feTurbulence 生成噪点
  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="noise" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" result="noise"/>
          <feColorMatrix type="saturate" values="0"/>
          <feComponentTransfer>
            <feFuncA type="linear" slope="${opacity * 3}" intercept="0"/>
          </feComponentTransfer>
        </filter>
      </defs>
      <rect width="100%" height="100%" filter="url(#noise)" opacity="${opacity}"/>
    </svg>
  `;
}

/**
 * 生成大气渐变遮罩（增强文字可读性）
 */
function generateAtmosphereGradient(width, height) {
  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="atmosphere" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:rgb(0,0,0);stop-opacity:0.25"/>
          <stop offset="30%" style="stop-color:rgb(0,0,0);stop-opacity:0"/>
          <stop offset="70%" style="stop-color:rgb(0,0,0);stop-opacity:0"/>
          <stop offset="100%" style="stop-color:rgb(0,0,0);stop-opacity:0.35"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#atmosphere)"/>
    </svg>
  `;
}

ipcMain.handle('generate-blur-poster', async (event, filePath, exifInfo, isPreview = false, exportQuality = 'high', logoScale = 1.0, logoPosition = 0.5, outputFormat = 'png') => {
  try {
    // exportQuality: 'high' = 原画质, 'fast' = 快速导出（限制最大 3000px）
    const MAX_SIZE_HIGH = 8000;   // 原画质最大 8000px（防止内存溢出）
    const MAX_SIZE_FAST = 3000;   // 快速导出最大 3000px
    const maxSize = isPreview ? 1200 : (exportQuality === 'fast' ? MAX_SIZE_FAST : MAX_SIZE_HIGH);

    let workImage = await getRotatedImageBuffer(filePath);

    // 根据质量设置限制分辨率
    workImage = await resizeImageBuffer(workImage.buffer, workImage.width, workImage.height, maxSize);

    const imgWidth = workImage.width;
    const imgHeight = workImage.height;

    // ========================================
    // 简洁相框风格 - 照片为主，底部信息条
    // ========================================
    const SIDE_PAD_RATIO = 0.055;   // 5.5% 侧边距
    const TOP_PAD_RATIO = 0.05;     // 5% 顶部边距
    const BOTTOM_INFO_RATIO = 0.13; // 13% 底部信息条

    // 检测是否为竖幅照片（高度 > 宽度）- 需要在 Logo 加载前定义
    const isPortrait = imgHeight > imgWidth;

    // ========================================
    // 步骤 1: 确定画布尺寸
    // ========================================
    const posterWidth = imgWidth;
    // 增加少量高度用于底部信息条
    const posterHeight = Math.round(imgHeight * (1 + TOP_PAD_RATIO + BOTTOM_INFO_RATIO));
    const H = posterHeight;

    // ========================================
    // 步骤 2: 计算照片区域
    // ========================================
    const topPad = Math.round(posterHeight * TOP_PAD_RATIO);
    const sidePad = Math.round(posterWidth * SIDE_PAD_RATIO);
    const bottomInfoHeight = Math.round(posterHeight * BOTTOM_INFO_RATIO);
    const availableWidth = posterWidth - sidePad * 2;
    const availableHeight = posterHeight - topPad - bottomInfoHeight;

    // ========================================
    // 步骤 3: 缩放照片
    // ========================================
    const photoScale = Math.min(availableWidth / imgWidth, availableHeight / imgHeight, 1);
    const mainW = Math.round(imgWidth * photoScale);
    const mainH = Math.round(imgHeight * photoScale);

    // ========================================
    // 步骤 4: 定位 - 照片水平居中，顶部对齐
    // ========================================
    const mainX = Math.round((posterWidth - mainW) / 2);
    const mainY = topPad;

    // ========================================
    // 步骤 5: 生成毛玻璃背景（优化：合并操作）
    // ========================================
    const blurRadius = isPreview ? 20 : 40;  // 稍微降低模糊半径以加速
    const bgScale = isPreview ? 0.15 : 0.25;  // 更小的中间尺寸以加速

    // 合并背景生成：缩小 → 调色 → 模糊 → 放大（一条链）
    const bgPromise = sharp(workImage.buffer)
      .resize(Math.round(posterWidth * bgScale), Math.round(posterHeight * bgScale), { fit: 'cover' })
      .modulate({ brightness: 0.5, saturation: 1.3 })
      .blur(blurRadius)
      .resize(posterWidth, posterHeight)
      .toBuffer();

    // ========================================
    // 步骤 6: 阴影（简化：使用纯色矩形 + 模糊）
    // ========================================
    const cornerRadius = Math.round(mainW * 0.02);  // 2% 圆角
    const shadowBlur = isPreview ? 12 : 25;
    const shadowOffsetY = isPreview ? 4 : 8;
    const shadowExpand = Math.round(shadowBlur * 1.0);

    const shadowSvgW = mainW + shadowExpand * 2;
    const shadowSvgH = mainH + shadowExpand * 2;
    const shadowScale = isPreview ? 0.2 : 0.35;

    const shadowSvg = `<svg width="${Math.round(shadowSvgW * shadowScale)}" height="${Math.round(shadowSvgH * shadowScale)}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${Math.round(shadowExpand * shadowScale)}" y="${Math.round(shadowExpand * shadowScale)}" 
        width="${Math.round(mainW * shadowScale)}" height="${Math.round(mainH * shadowScale)}" 
        rx="${Math.round(cornerRadius * shadowScale)}" fill="rgba(0,0,0,0.3)"/>
    </svg>`;

    const shadowPromise = sharp(Buffer.from(shadowSvg))
      .blur(Math.round(shadowBlur * shadowScale) + 1)
      .resize(shadowSvgW, shadowSvgH)
      .toBuffer();

    const shadowX = mainX - shadowExpand;
    const shadowY = mainY - shadowExpand + shadowOffsetY;

    // ========================================
    // 步骤 7: 圆角照片（优化：单次操作）
    // ========================================
    const roundedMaskSvg = `<svg width="${mainW}" height="${mainH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${mainW}" height="${mainH}" rx="${cornerRadius}" fill="white"/>
    </svg>`;

    const photoPromise = sharp(workImage.buffer)
      .resize(mainW, mainH, { fit: 'fill' })
      .composite([{ input: Buffer.from(roundedMaskSvg), blend: 'dest-in' }])
      .png({ compressionLevel: 6 })
      .toBuffer();

    // 并行执行背景、阴影、照片处理
    const [bgBuffer, shadowBuffer, roundedMainImg] = await Promise.all([
      bgPromise, shadowPromise, photoPromise
    ]);

    // 叠加大气渐变和噪点（合并到最终合成）
    const backgroundLayers = [
      { input: Buffer.from(generateAtmosphereGradient(posterWidth, posterHeight)), blend: 'over' }
    ];

    if (!isPreview) {
      backgroundLayers.push({
        input: Buffer.from(generateNoiseSvg(posterWidth, posterHeight, 0.02)),
        blend: 'over'
      });
    }

    let blurredBg = await sharp(bgBuffer)
      .composite(backgroundLayers)
      .toBuffer();

    // ========================================
    // 步骤 8: 加载品牌 Logo（16% 画布宽度，中心 y = H * 0.09）
    // ========================================
    let logoBuffer = null;
    let logoWidth = 0;
    let logoHeight = 0;

    const logoPath = getLogoPath(exifInfo.cameraMake);
    if (logoPath) {
      try {
        const logoMeta = await sharp(logoPath).metadata();
        // 竖幅照片 Logo 更大（20% 宽度），横幅照片适中（12%），并应用用户自定义缩放
        const baseLogoWidthRatio = isPortrait ? 0.20 : 0.12;
        const baseLogoHeightRatio = isPortrait ? 0.40 : 0.30;
        const logoWidthRatio = baseLogoWidthRatio * logoScale;
        const logoHeightRatio = baseLogoHeightRatio * logoScale;
        const maxLogoWidth = Math.round(posterWidth * logoWidthRatio);
        const maxLogoHeight = Math.round(bottomInfoHeight * logoHeightRatio);

        const aspectRatio = logoMeta.width / logoMeta.height;
        // 先按宽度计算
        logoWidth = maxLogoWidth;
        logoHeight = Math.round(logoWidth / aspectRatio);

        // 如果高度超出限制，按高度重新计算
        if (logoHeight > maxLogoHeight) {
          logoHeight = maxLogoHeight;
          logoWidth = Math.round(logoHeight * aspectRatio);
        }

        logoBuffer = await sharp(logoPath)
          .resize(logoWidth, logoHeight, { fit: 'inside' })
          .toBuffer();
      } catch (e) {
        console.warn('Logo 加载失败:', e.message);
        logoBuffer = null;
      }
    }

    // ========================================
    // 步骤 9: 底部信息条（Logo + 参数）
    // ========================================
    // 底部信息条起始 Y 坐标
    const infoStartY = posterHeight - bottomInfoHeight;
    // 底部信息条的垂直中心
    const infoCenterY = infoStartY + Math.round(bottomInfoHeight / 2);


    // 竖幅照片使用更大的字体（增大 75%）
    const fontBase = isPortrait ? posterWidth * 0.035 : posterWidth * 0.020;
    const paramsFontSize = Math.round(fontBase);
    const modelFontSize = Math.round(fontBase);

    const params = [];
    if (exifInfo.focalLength) params.push(exifInfo.focalLength);
    if (exifInfo.aperture) params.push(exifInfo.aperture);
    if (exifInfo.shutterSpeed) params.push(exifInfo.shutterSpeed);
    if (exifInfo.iso) params.push(`ISO ${exifInfo.iso}`);
    const paramsText = escapeXml(params.join('  ·  '));

    let textSvg;
    let logoX = 0, logoY = 0;

    if (logoBuffer) {
      // 有 Logo：布局从上到下：Logo -> 相机镜头 -> 拍摄参数
      const cameraModel = escapeXml(exifInfo.cameraModel || '');
      const lensModel = escapeXml(exifInfo.lensModel || '');
      const cameraLine = cameraModel + (lensModel ? '  ·  ' + lensModel : '');
      const cameraFontSize = Math.round(fontBase * 0.9);

      // 参数 Y：底部信息条最下方
      const paramsY = posterHeight - Math.round(bottomInfoHeight * 0.15);
      // 相机镜头 Y：参数上方
      const cameraY = paramsY - Math.round(paramsFontSize * 1.4);
      // Logo Y：使用用户指定的位置比例 (0=最上, 1=最下)
      // 计算“安全”区域
      const safeTop = infoStartY;
      const safeBottom = cameraY - Math.round(cameraFontSize * 0.8) - logoHeight;

      // 添加缓冲空间以增加调节范围（允许一定程度的溢出或留白）
      const rangeBuffer = Math.round(bottomInfoHeight * 0.4);
      const minLogoY = safeTop - rangeBuffer;
      const maxLogoY = safeBottom + rangeBuffer;

      logoY = minLogoY + Math.round((maxLogoY - minLogoY) * logoPosition);
      logoX = Math.round((posterWidth - logoWidth) / 2);

      textSvg = `
        <svg width="${posterWidth}" height="${posterHeight}" xmlns="http://www.w3.org/2000/svg">
          <text x="${posterWidth / 2}" y="${cameraY}" text-anchor="middle" 
            font-family="Helvetica Neue, Arial, sans-serif" font-size="${cameraFontSize}px" 
            fill="rgba(255,255,255,0.85)" font-weight="400" letter-spacing="1">${cameraLine}</text>
          <text x="${posterWidth / 2}" y="${paramsY}" text-anchor="middle" 
            font-family="Helvetica Neue, Arial, sans-serif" font-size="${paramsFontSize}px" 
            fill="rgba(255,255,255,0.6)" font-weight="300" letter-spacing="1.5">${paramsText}</text>
        </svg>
      `;
    } else {
      // 无 Logo：显示品牌+型号
      const brandName = getBrandName(exifInfo.cameraMake);
      const cameraModel = escapeXml(exifInfo.cameraModel || '');
      const modelLine = brandName ? `${brandName}  ·  ${cameraModel}` : cameraModel;
      const modelY = infoCenterY - Math.round(paramsFontSize * 0.5);
      const paramsY = modelY + Math.round(modelFontSize * 1.4);
      textSvg = `
        <svg width="${posterWidth}" height="${posterHeight}" xmlns="http://www.w3.org/2000/svg">
          <text x="${posterWidth / 2}" y="${modelY}" text-anchor="middle" 
            font-family="Helvetica Neue, Arial, sans-serif" font-size="${modelFontSize}px" 
            fill="#ffffff" font-weight="500" letter-spacing="2">${escapeXml(modelLine)}</text>
          <text x="${posterWidth / 2}" y="${paramsY}" text-anchor="middle" 
            font-family="Helvetica Neue, Arial, sans-serif" font-size="${paramsFontSize}px" 
            fill="rgba(255,255,255,0.7)" font-weight="300" letter-spacing="1.5">${paramsText}</text>
        </svg>
      `;
    }

    // ========================================
    // 步骤 10: 合成最终海报
    // ========================================
    const composites = [
      { input: shadowBuffer, top: shadowY, left: shadowX, blend: 'over' },
      { input: roundedMainImg, top: mainY, left: mainX },
      { input: Buffer.from(textSvg), top: 0, left: 0 }
    ];

    // 如果有 Logo，添加到合成层
    if (logoBuffer) {
      composites.push({ input: logoBuffer, top: logoY, left: logoX });
    }

    const poster = await encodePoster(
      sharp(blurredBg).composite(composites),
      outputFormat
    );

    // 释放内存
    workImage.buffer = null;
    blurredBg = null;

    return poster;
  } catch (e) {
    console.error('生成毛玻璃海报失败:', e);
    throw e;
  }
});

ipcMain.handle('save-poster', async (event, buffer, filePath, format) => {
  try {
    const outputBuffer = Buffer.from(buffer);
    const isJpegBuffer = outputBuffer.length > 3 &&
      outputBuffer[0] === 0xff &&
      outputBuffer[1] === 0xd8 &&
      outputBuffer[2] === 0xff;
    const isPngBuffer = outputBuffer.length > 8 &&
      outputBuffer[0] === 0x89 &&
      outputBuffer[1] === 0x50 &&
      outputBuffer[2] === 0x4e &&
      outputBuffer[3] === 0x47;

    if ((format === 'jpg' || format === 'jpeg') && !isJpegBuffer) {
      fs.writeFileSync(filePath, await sharp(outputBuffer).jpeg({ quality: 95 }).toBuffer());
      return true;
    }

    if (format === 'png' && !isPngBuffer) {
      fs.writeFileSync(filePath, await sharp(outputBuffer).png().toBuffer());
      return true;
    }

    fs.writeFileSync(filePath, outputBuffer);
    return true;
  } catch (e) {
    throw e;
  }
});
