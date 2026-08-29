// ===== 素材库扩展程序 - 后台服务 =====
const DB_NAME = 'asset_library_ext';
const STORE_NAME = 'images';
let db = null;

// 初始化 IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('folderId', 'folderId', { unique: false });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e);
  });
}

function dbPut(item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e);
  });
}

// 初始化
openDB().catch(console.error);

// ===== 右键菜单 =====
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-to-asset-library',
    title: '保存到素材库',
    contexts: ['image']
  });
  chrome.contextMenus.create({
    id: 'save-and-tag',
    title: '保存到素材库并添加标签...',
    contexts: ['image']
  });
  chrome.contextMenus.create({
    id: 'open-asset-library',
    title: '打开素材库',
    contexts: ['action', 'page']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-to-asset-library' && info.srcUrl) {
    // 优先保存页面中的最高清版本
    const bestUrl = await getBestUrlFromTab(tab.id, info.srcUrl);
    const result = await saveImage(bestUrl || info.srcUrl, tab.url, tab.title);
    notifyResult(result, tab.id);
  }
  if (info.menuItemId === 'save-and-tag' && info.srcUrl) {
    // 发送消息给 content script 弹出标签输入（带最高清 URL）
    const bestUrl = await getBestUrlFromTab(tab.id, info.srcUrl);
    chrome.tabs.sendMessage(tab.id, { type: 'SHOW_TAG_DIALOG', imageUrl: bestUrl || info.srcUrl, pageUrl: tab.url });
  }
  if (info.menuItemId === 'open-asset-library') {
    openAssetLibraryPage();
  }
});

// 向页面询问某张图片的最高清 URL（content script 解析）
function getBestUrlFromTab(tabId, srcUrl) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'GET_BEST_IMAGE_URL', srcUrl }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.success || !resp.url) resolve(null);
        else resolve(resp.url);
      });
    } catch (e) { resolve(null); }
  });
}

// ===== 消息处理 =====
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.type) {
        case 'SAVE_IMAGE': {
          const result = await saveImage(request.imageUrl, request.pageUrl, request.pageTitle, request.tags, request.folderId);
          sendResponse(result);
          break;
        }
        case 'SAVE_IMAGE_BLOB': {
          // 支持 base64 字符串或 Blob 对象
          let blob;
          if (typeof request.blobData === 'string') {
            blob = base64ToBlob(request.blobData, request.mimeType || 'image/png');
          } else if (request.blobData instanceof Blob) {
            blob = request.blobData;
          } else {
            sendResponse({ success: false, error: '无效的图片数据' });
            break;
          }
          const result = await saveImageBlob(blob, request.name, request.pageUrl, request.tags, request.folderId);
          sendResponse(result);
          break;
        }
        case 'GET_RECENT': {
          const images = await getRecentImages(request.count || 12);
          sendResponse({ success: true, images });
          break;
        }
        case 'GET_ALL': {
          const images = await dbGetAll();
          sendResponse({ success: true, images });
          break;
        }
        case 'DELETE_IMAGE': {
          await dbDelete(request.id);
          sendResponse({ success: true });
          break;
        }
        case 'GET_CONFIG': {
          const config = await getConfig();
          sendResponse({ success: true, config });
          break;
        }
        case 'SAVE_CONFIG': {
          await saveConfig(request.config);
          sendResponse({ success: true });
          break;
        }
        case 'SYNC_INDEX_HTML': {
          const config = request.config || await getConfig();
          const result = await updateIndexHtml(config);
          sendResponse({ success: true, count: result.count });
          break;
        }
        case 'ENABLE_PAGES': {
          const config = request.config || await getConfig();
          const result = await enableGitHubPages(config);
          sendResponse(result);
          break;
        }
        case 'GET_PAGES_STATUS': {
          const config = request.config || await getConfig();
          const result = await getPagesStatus(config);
          sendResponse(result);
          break;
        }
        case 'EXPORT_DATA': {
          const data = await exportAllData();
          sendResponse({ success: true, data });
          break;
        }
        case 'IMPORT_DATA': {
          const result = await importData(request.data);
          sendResponse(result);
          break;
        }
        case 'OPEN_LIBRARY': {
          openAssetLibraryPage();
          sendResponse({ success: true });
          break;
        }
        case 'GET_STATS': {
          const images = await dbGetAll();
          const totalSize = images.reduce((sum, img) => sum + (img.size || 0), 0);
          sendResponse({ success: true, count: images.length, totalSize });
          break;
        }
        case 'UPDATE_IMAGE': {
          const all = await dbGetAll();
          const idx = all.findIndex(x => x.id === request.id);
          if (idx >= 0) {
            const updated = { ...all[idx], ...request.updates };
            await dbPut(updated);
            sendResponse({ success: true, asset: updated });
          } else {
            sendResponse({ success: false, error: 'Image not found' });
          }
          break;
        }
        case 'BATCH_UPDATE': {
          const all = await dbGetAll();
          const idSet = new Set(request.ids);
          for (const img of all) {
            if (idSet.has(img.id)) {
              await dbPut({ ...img, ...request.updates });
            }
          }
          sendResponse({ success: true });
          break;
        }
        case 'BATCH_DELETE': {
          for (const id of request.ids) {
            await dbDelete(id);
          }
          sendResponse({ success: true });
          break;
        }
        case 'CLEAR_ALL': {
          const all = await dbGetAll();
          for (const img of all) {
            await dbDelete(img.id);
          }
          sendResponse({ success: true });
          break;
        }
        case 'IMPORT_JSON': {
          let count = 0;
          for (const img of request.images) {
            if (img.id && (img.blobData || img.url)) {
              await dbPut({ ...img, id: img.id });
              count++;
            }
          }
          sendResponse({ success: true, imported: count });
          break;
        }
        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Background error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  return true; // 异步响应
});

// ===== 图片保存核心逻辑 =====
async function saveImage(imageUrl, pageUrl, pageTitle, tags = [], folderId = null) {
  try {
    // 下载图片
    const response = await fetch(imageUrl, { mode: 'cors' }).catch(() => fetch(imageUrl));
    if (!response.ok) throw new Error('图片下载失败: ' + response.status);
    const blob = await response.blob();
    
    // 从 URL 提取文件名
    const urlPath = new URL(imageUrl).pathname;
    const fileName = urlPath.split('/').pop() || 'image_' + Date.now();
    
    return await saveImageBlob(blob, fileName, pageUrl, tags, folderId, pageTitle, imageUrl);
  } catch (error) {
    console.error('保存图片失败:', error);
    // 如果下载失败（跨域等），尝试只保存 URL
    return {
      success: true,
      warning: '图片以URL方式保存（跨域限制）',
      asset: {
        id: genId(),
        name: 'image_' + Date.now(),
        url: imageUrl,
        blobData: null,
        mimeType: 'image/url',
        size: 0,
        pageUrl: pageUrl || '',
        tags,
        folderId,
        favorite: false,
        deleted: false,
        createdAt: Date.now()
      }
    };
  }
}

async function saveImageBlob(blob, name, pageUrl, tags = [], folderId = null, pageTitle = '', originalUrl = '') {
  const id = genId();
  const arrayBuffer = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);
  
  const asset = {
    id,
    name: name.replace(/\.[^/.]+$/, ''),
    url: originalUrl || null,
    blobData: base64,
    mimeType: blob.type || 'image/png',
    size: blob.size,
    pageUrl: pageUrl || '',
    pageTitle: pageTitle || '',
    tags: Array.isArray(tags) ? tags : [],
    folderId,
    colors: [],
    width: 0,
    height: 0,
    phash: '',
    favorite: false,
    deleted: false,
    createdAt: Date.now()
  };
  
  await dbPut(asset);
  
  // 云端同步（如果配置了）
  const config = await getConfig();
  if (config.cloudEnabled && config.cloudProvider) {
    syncToCloud(asset, config).catch(err => console.warn('云端同步失败:', err));
  }
  
  return { success: true, asset };
}

// ===== 云端同步 =====
async function syncToCloud(asset, config) {
  if (config.cloudProvider === 'github') {
    return syncToGitHub(asset, config);
  }
  if (config.cloudProvider === 'custom') {
    return syncToCustomAPI(asset, config);
  }
}

async function syncToGitHub(asset, config) {
  let { githubToken, githubRepo, githubBranch = 'main', githubPath = 'assets' } = config;
  githubRepo = normalizeRepo(githubRepo);
  if (!githubToken || !githubRepo) throw new Error('GitHub 配置不完整');
  
  const fileName = `${asset.id}.${getExtension(asset.mimeType)}`;
  const path = `${githubPath}/${fileName}`;
  
  const response = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${githubToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `Add asset: ${asset.name}`,
      content: asset.blobData,
      branch: githubBranch
    })
  });
  
  if (!response.ok) throw new Error('GitHub API 错误: ' + response.status);
  const data = await response.json();
  asset.githubUrl = data.content?.download_url;
  await dbPut(asset);
  // 自动生成/更新 GitHub Pages 展示页 index.html
  try {
    await updateIndexHtml(config);
  } catch (e) {
    console.warn('自动更新 index.html 失败:', e.message);
  }
  return data;
}

// ===== GitHub Pages：自动生成 index.html 展示页 =====
function escHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function generateIndexHtml(images) {
  const data = images.map(a => ({
    id: a.id,
    name: a.name,
    url: a.githubUrl || a.url || '',
    width: a.width || 0,
    height: a.height || 0,
    tags: a.tags || [],
    createdAt: a.createdAt || 0
  }));
  const cards = data.map((a, i) => {
    const tagHtml = (a.tags || []).slice(0, 3).map(t => `<span class="tag">${escHtml(t)}</span>`).join('');
    const meta = (a.width ? a.width + '×' + a.height : '') + (a.createdAt ? ' · ' + new Date(a.createdAt).toLocaleDateString('zh-CN') : '');
    return `<div class="card" onclick="openLb(${i})"><div class="thumb"><img src="${escHtml(a.url)}" alt="${escHtml(a.name)}" loading="lazy"></div><div class="info"><div class="name">${escHtml(a.name)}</div><div class="meta">${meta}</div>${tagHtml ? '<div class="tags">' + tagHtml + '</div>' : ''}</div></div>`;
  }).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>我的素材库</title><style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#161616;color:#e8e8e8;min-height:100vh;}
.header{padding:18px 24px;border-bottom:1px solid #333;display:flex;align-items:center;gap:16px;position:sticky;top:0;background:#161616;z-index:100;}
.header h1{font-size:18px;font-weight:600;color:#f0a030;}
.header .count{font-size:12px;color:#6b6b6b;}
.search{flex:1;max-width:320px;margin-left:auto;}
.search input{width:100%;height:34px;background:#252525;border:1px solid #333;border-radius:8px;padding:0 12px;color:#e8e8e8;font-size:13px;outline:none;}
.search input:focus{border-color:#f0a030;}
.main{padding:24px;}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;}
.card{background:#1e1e1e;border:1px solid #333;border-radius:10px;overflow:hidden;cursor:pointer;transition:all .15s;}
.card:hover{border-color:#f0a030;transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.4);}
.thumb{width:100%;aspect-ratio:1;background:#252525;overflow:hidden;}
.thumb img{width:100%;height:100%;object-fit:cover;transition:transform .3s;}
.card:hover .thumb img{transform:scale(1.05);}
.info{padding:9px 11px;}
.name{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.meta{font-size:10px;color:#6b6b6b;margin-top:3px;}
.tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;}
.tag{padding:1px 7px;background:#252525;border-radius:8px;font-size:10px;color:#a0a0a0;}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:50vh;color:#6b6b6b;gap:10px;}
.lightbox{position:fixed;inset:0;background:rgba(0,0,0,.95);display:none;align-items:center;justify-content:center;z-index:1000;}
.lightbox.show{display:flex;}
.lightbox img{max-width:90vw;max-height:85vh;object-fit:contain;}
.lightbox .close{position:absolute;top:16px;right:16px;width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.1);border:none;color:#fff;font-size:20px;cursor:pointer;}
.lightbox .info{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);background:rgba(30,30,30,.9);padding:7px 16px;border-radius:8px;font-size:12px;color:#a0a0a0;max-width:80vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
@media(max-width:600px){.grid{grid-template-columns:repeat(auto-fill,minmax(120px,1fr));}}
</style></head><body><div class="header"><h1>我的素材库</h1><span class="count" id="count"></span><div class="search"><input type="text" id="searchInput" placeholder="搜索素材..."></div></div><div class="main"><div class="grid" id="grid">${cards || '<div class="empty">还没有素材</div>'}</div></div><div class="lightbox" id="lb"><button class="close" onclick="closeLb()">&times;</button><img id="lbImg" src=""><div class="info" id="lbInfo"></div></div><script>
const DATA=${JSON.stringify(data)};
document.getElementById('count').textContent=DATA.length+' 张图片';
document.getElementById('searchInput').addEventListener('input',function(e){
  const q=e.target.value.toLowerCase();
  document.getElementById('grid').innerHTML=DATA.filter(a=>!q||a.name.toLowerCase().includes(q)||(a.tags||[]).some(t=>t.toLowerCase().includes(q)))
    .map((a,i)=>'<div class="card" onclick="openLb('+i+')"><div class="thumb"><img src="'+a.url+'" alt="'+a.name+'" loading="lazy"></div><div class="info"><div class="name">'+a.name+'</div></div></div>').join('')||'<div class="empty">没有找到匹配的素材</div>';
});
function openLb(i){const a=DATA[i];if(!a)return;document.getElementById('lbImg').src=a.url;document.getElementById('lbInfo').textContent=a.name+(a.width?' · '+a.width+'×'+a.height:'');document.getElementById('lb').classList.add('show');}
function closeLb(){document.getElementById('lb').classList.remove('show');}
document.getElementById('lb').addEventListener('click',function(e){if(e.target.id==='lb')closeLb();});
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeLb();});
<\/script></body></html>`;
}
async function updateIndexHtml(config) {
  let { githubToken, githubRepo, githubBranch = 'main' } = config;
  githubRepo = normalizeRepo(githubRepo);
  if (!githubToken || !githubRepo) throw new Error('GitHub 配置不完整');
  const images = (await dbGetAll()).filter(a => a.githubUrl && !a.deleted);
  const html = generateIndexHtml(images);
  const path = 'index.html';
  // 检查文件是否已存在（获取 sha）
  let sha = null;
  const check = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${path}?ref=${githubBranch}`, {
    headers: { 'Authorization': `token ${githubToken}` }
  });
  if (check.ok) {
    const d = await check.json();
    sha = d.sha;
  } else if (check.status !== 404) {
    throw new Error('检查仓库失败：' + await githubErrorText(check));
  }
  const body = {
    message: `更新素材库展示页（${images.length} 张图片）`,
    content: btoa(unescape(encodeURIComponent(html))),
    branch: githubBranch
  };
  if (sha) body.sha = sha;
  const resp = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${githubToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const gh = await githubErrorText(resp);
    if (resp.status === 401 || resp.status === 403) throw new Error('更新失败：Token 无效或缺少仓库写入权限（需要 repo 权限）' + (gh ? '。' + gh : ''));
    if (resp.status === 404) throw new Error('更新失败：仓库或分支不存在，请检查「仓库名」和「分支」填写是否正确' + (gh ? '。' + gh : ''));
    if (resp.status === 409) throw new Error('更新失败：仓库还没有初始提交，请先在仓库创建一个文件（如在 GitHub 网页上勾选 Add a README file 后再试）' + (gh ? '。' + gh : ''));
    throw new Error('更新 index.html 失败: ' + resp.status + (gh ? ' ' + gh : ''));
  }
  return { count: images.length };
}
async function enableGitHubPages(config) {
  let { githubToken, githubRepo, githubBranch = 'main' } = config;
  githubRepo = normalizeRepo(githubRepo);
  if (!githubToken || !githubRepo) throw new Error('GitHub 配置不完整');
  const resp = await fetch(`https://api.github.com/repos/${githubRepo}/pages`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${githubToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ source: { branch: githubBranch, path: '/' } })
  });
  if (resp.status === 201) {
    const data = await resp.json();
    return { success: true, url: data.html_url };
  }
  if (resp.status === 409) {
    const info = await fetch(`https://api.github.com/repos/${githubRepo}/pages`, {
      headers: { 'Authorization': `token ${githubToken}` }
    });
    if (info.ok) {
      const d = await info.json();
      return { success: true, url: d.html_url, already: true };
    }
    throw new Error('GitHub Pages 已开启，但获取地址失败');
  }
  const gh = await githubErrorText(resp);
  if (resp.status === 422) throw new Error('开启失败：GitHub Pages 仅支持公开仓库（私有仓库需付费），请将仓库设为 Public' + (gh ? '。' + gh : ''));
  if (resp.status === 401 || resp.status === 403) throw new Error('开启失败：Token 无效或权限不足（需要 repo 权限）' + (gh ? '。' + gh : ''));
  if (resp.status === 404) throw new Error('开启失败：仓库不存在或分支「' + githubBranch + '」不存在，请检查填写' + (gh ? '。' + gh : ''));
  if (resp.status === 429) throw new Error('开启失败：GitHub API 请求过于频繁，请稍后再试');
  throw new Error('开启 GitHub Pages 失败: ' + resp.status + (gh ? ' ' + gh : ''));
}
async function getPagesStatus(config) {
  let { githubToken, githubRepo } = config;
  githubRepo = normalizeRepo(githubRepo);
  if (!githubToken || !githubRepo) return { success: true, enabled: false };
  const resp = await fetch(`https://api.github.com/repos/${githubRepo}/pages`, {
    headers: { 'Authorization': `token ${githubToken}` }
  });
  if (resp.ok) {
    const d = await resp.json();
    return { success: true, enabled: true, url: d.html_url, status: d.status, branch: d.source ? d.source.branch : '' };
  }
  if (resp.status === 404) return { success: true, enabled: false };
  return { success: false, error: '查询失败: ' + resp.status + ' ' + await githubErrorText(resp) };
}
// 提取 GitHub API 错误返回中的 message
async function githubErrorText(resp) {
  try {
    const t = await resp.text();
    if (!t) return '';
    try { const j = JSON.parse(t); return j.message || t.slice(0, 200); } catch (e) { return t.slice(0, 200); }
  } catch (e) { return ''; }
}
// 规范化仓库名：支持 "用户名/仓库名" 或完整 URL "https://github.com/用户名/仓库名"
function normalizeRepo(repo) {
  if (!repo) return '';
  let r = String(repo).trim();
  // 去掉前后斜杠
  r = r.replace(/^\/+|\/+$/g, '');
  // 如果是完整 URL，提取 owner/repo
  const m = r.match(/github\.com\/([^\/]+)\/([^\/?#]+)/);
  if (m) r = m[1] + '/' + m[2];
  return r;
}

async function syncToCustomAPI(asset, config) {
  const { apiUrl, apiKey } = config;
  if (!apiUrl) throw new Error('API 地址未配置');
  
  const formData = new FormData();
  const blob = base64ToBlob(asset.blobData, asset.mimeType);
  formData.append('file', blob, asset.name + '.' + getExtension(asset.mimeType));
  formData.append('metadata', JSON.stringify({
    name: asset.name,
    tags: asset.tags,
    folderId: asset.folderId,
    pageUrl: asset.pageUrl
  }));
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
    body: formData
  });
  
  if (!response.ok) throw new Error('API 错误: ' + response.status);
  return response.json();
}

// ===== 配置管理 =====
async function getConfig() {
  const data = await chrome.storage.sync.get(['assetLibraryConfig']);
  return data.assetLibraryConfig || {
    cloudEnabled: false,
    cloudProvider: 'local',
    githubToken: '',
    githubRepo: '',
    githubBranch: 'main',
    githubPath: 'assets',
    apiUrl: '',
    apiKey: '',
    defaultFolder: null,
    autoAnalyze: true,
    showDragButton: true,
    contextMenuEnabled: true
  };
}

async function saveConfig(config) {
  await chrome.storage.sync.set({ assetLibraryConfig: config });
}

// ===== 数据导入导出 =====
async function exportAllData() {
  const images = await dbGetAll();
  const config = await getConfig();
  return {
    version: '2.0',
    exportedAt: new Date().toISOString(),
    images,
    config
  };
}

async function importData(data) {
  if (!data.images || !Array.isArray(data.images)) {
    return { success: false, error: '无效的数据格式' };
  }
  let count = 0;
  for (const img of data.images) {
    if (img.id && img.blobData) {
      await dbPut({ ...img, id: img.id });
      count++;
    }
  }
  return { success: true, imported: count };
}

// ===== 工具函数 =====
function genId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBlob(base64, mimeType) {
  const byteCharacters = atob(base64);
  const byteArrays = [];
  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    byteArrays.push(new Uint8Array(byteNumbers));
  }
  return new Blob(byteArrays, { type: mimeType });
}

function getExtension(mimeType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp'
  };
  return map[mimeType] || 'png';
}

async function getRecentImages(count = 12) {
  const all = await dbGetAll();
  return all
    .filter(img => !img.deleted)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, count);
}

function notifyResult(result, tabId) {
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      type: 'SHOW_TOAST',
      message: result.success ? (result.warning || '图片已保存到素材库') : '保存失败: ' + result.error,
      type: result.success ? 'success' : 'error'
    }).catch(() => {});
  }
}

function openAssetLibraryPage() {
  const url = chrome.runtime.getURL('options.html') + '#library';
  chrome.tabs.create({ url });
}

// 监听扩展图标点击（如果没有 popup 的话，但我们有 popup，所以这个不需要）
// chrome.action.onClicked.addListener(() => openAssetLibraryPage());

console.log('素材库扩展程序后台已启动');
