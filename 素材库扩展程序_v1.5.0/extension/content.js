// ===== 素材库扩展程序 - 页面内容脚本 =====
(function() {
  'use strict';

  // 防止重复注入
  if (window.__assetLibraryInjected) return;
  window.__assetLibraryInjected = true;

  let config = {
    showDragButton: true,
    contextMenuEnabled: true,
    autoAnalyze: true
  };

  // 获取配置
  chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
    if (response && response.success) {
      config = { ...config, ...response.config };
      if (config.showDragButton) initDragButton();
    }
  });

  // ===== 悬浮拖拽按钮 =====
  let dragButton = null;
  let isDragging = false;
  let dragImageEl = null;

  function initDragButton() {
    if (dragButton) return;
    
    dragButton = document.createElement('div');
    dragButton.id = 'asset-library-drag-btn';
    dragButton.title = '拖拽图片到这里保存到素材库';
    dragButton.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <span class="ald-badge">0</span>
    `;
    document.body.appendChild(dragButton);

    // 按钮可拖动位置
    let isMoving = false, startX, startY, btnLeft, btnTop;
    dragButton.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      isMoving = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = dragButton.getBoundingClientRect();
      btnLeft = rect.left;
      btnTop = rect.top;
      dragButton.style.transition = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isMoving) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      dragButton.style.left = (btnLeft + dx) + 'px';
      dragButton.style.top = (btnTop + dy) + 'px';
      dragButton.style.right = 'auto';
      dragButton.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (isMoving) {
        isMoving = false;
        dragButton.style.transition = '';
        // 保存位置
        const rect = dragButton.getBoundingClientRect();
        localStorage.setItem('assetLibraryBtnPos', JSON.stringify({ left: rect.left, top: rect.top }));
      }
    });

    // 恢复位置
    const savedPos = localStorage.getItem('assetLibraryBtnPos');
    if (savedPos) {
      try {
        const pos = JSON.parse(savedPos);
        dragButton.style.left = pos.left + 'px';
        dragButton.style.top = pos.top + 'px';
        dragButton.style.right = 'auto';
        dragButton.style.bottom = 'auto';
      } catch(e) {}
    }

    // 点击打开素材库
    dragButton.addEventListener('click', (e) => {
      if (isMoving) return;
      chrome.runtime.sendMessage({ type: 'OPEN_LIBRARY' });
    });

    // 接收拖入的图片
    ['dragenter', 'dragover'].forEach(evt => {
      dragButton.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragButton.classList.add('ald-active');
      });
    });

    ['dragleave', 'drop'].forEach(evt => {
      dragButton.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragButton.classList.remove('ald-active');
      });
    });

    dragButton.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        Array.from(files).forEach(f => {
          if (f.type.startsWith('image/')) {
            saveFile(f);
          }
        });
      } else if (dragImageEl) {
        // 从页面拖来的图片：保存其最高清版本
        saveImageUrl(getBestImageUrl(dragImageEl));
      } else {
        // 尝试从拖拽的 HTML 中提取图片 URL
        const html = e.dataTransfer.getData('text/html');
        if (html) {
          const urls = extractImageUrls(html);
          urls.forEach(url => saveImageUrl(getBestUrlFromString(url)));
        }
      }
    });

    updateBadge();
  }

  // ===== 全局图片拖拽捕获 =====
  document.addEventListener('dragstart', (e) => {
    if (e.target.tagName === 'IMG') {
      dragImageEl = e.target;
      e.dataTransfer.setData('text/plain', getBestImageUrl(e.target));
    }
  });

  document.addEventListener('dragend', () => {
    dragImageEl = null;
  });

  // 监听全局 drop，捕获从其他地方拖来的图片
  document.addEventListener('drop', (e) => {
    // 如果已经有处理者，不重复处理
    if (e.defaultPrevented) return;
    
    const files = e.dataTransfer.files;
    if (files.length > 0 && config.showDragButton) {
      // 有文件拖到页面上，显示提示
      const hasImage = Array.from(files).some(f => f.type.startsWith('image/'));
      if (hasImage) {
        showDropHint(e.clientX, e.clientY);
      }
    }
  });

  function showDropHint(x, y) {
    const hint = document.createElement('div');
    hint.className = 'ald-drop-hint';
    hint.textContent = '拖到右下角橙色按钮保存到素材库';
    hint.style.left = x + 'px';
    hint.style.top = y + 'px';
    document.body.appendChild(hint);
    setTimeout(() => hint.remove(), 2000);
  }

  // ===== 图片上的快速保存按钮 =====
  let hoverTimer = null;
  let quickSaveBtn = null;

  document.addEventListener('mouseover', (e) => {
    if (e.target.tagName === 'IMG' && e.target.naturalWidth > 50) {
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => showQuickSaveBtn(e.target), 500);
    }
  });

  document.addEventListener('mouseout', (e) => {
    if (e.target.tagName === 'IMG') {
      clearTimeout(hoverTimer);
    }
  });

  function showQuickSaveBtn(img) {
    removeQuickSaveBtn();
    
    const rect = img.getBoundingClientRect();
    if (rect.width < 60 || rect.height < 60) return;
    
    quickSaveBtn = document.createElement('div');
    quickSaveBtn.className = 'ald-quick-save';
    quickSaveBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
      <span>存素材库</span>
    `;
    quickSaveBtn.style.top = (rect.top + window.scrollY + 8) + 'px';
    quickSaveBtn.style.left = (rect.left + window.scrollX + 8) + 'px';
    
    quickSaveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      saveImageUrl(getBestImageUrl(img));
      quickSaveBtn.classList.add('ald-saving');
      setTimeout(() => removeQuickSaveBtn(), 1500);
    });
    
    document.body.appendChild(quickSaveBtn);
    
    // 鼠标离开按钮区域后移除
    quickSaveBtn.addEventListener('mouseleave', () => {
      setTimeout(() => {
        if (!quickSaveBtn?.matches(':hover')) removeQuickSaveBtn();
      }, 300);
    });
  }

  function removeQuickSaveBtn() {
    if (quickSaveBtn) {
      quickSaveBtn.remove();
      quickSaveBtn = null;
    }
  }

  // ===== 保存函数 =====
  function saveImageUrl(url, tags = []) {
    chrome.runtime.sendMessage({
      type: 'SAVE_IMAGE',
      imageUrl: url,
      pageUrl: window.location.href,
      pageTitle: document.title,
      tags
    }, (response) => {
      if (response && response.success) {
        showToast(response.warning || '图片已保存到素材库', 'success');
        updateBadge();
      } else {
        showToast('保存失败: ' + (response?.error || '未知错误'), 'error');
      }
    });
  }

  function saveFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      chrome.runtime.sendMessage({
        type: 'SAVE_IMAGE_BLOB',
        blobData: e.target.result.split(',')[1],
        mimeType: file.type,
        name: file.name,
        pageUrl: window.location.href,
        tags: []
      }, (response) => {
        if (response && response.success) {
          showToast('图片已保存到素材库', 'success');
          updateBadge();
        } else {
          showToast('保存失败', 'error');
        }
      });
    };
    reader.readAsDataURL(file);
  }

  // ===== 标签输入对话框 =====
  function showTagDialog(imageUrl) {
    const overlay = document.createElement('div');
    overlay.className = 'ald-modal-overlay';
    overlay.innerHTML = `
      <div class="ald-modal">
        <div class="ald-modal-header">
          <h3>保存到素材库</h3>
          <button class="ald-modal-close">&times;</button>
        </div>
        <div class="ald-modal-body">
          <div class="ald-form-group">
            <label>标签（用逗号分隔）</label>
            <input type="text" class="ald-tag-input" placeholder="设计, 灵感, UI" />
          </div>
          <div class="ald-form-group">
            <label>文件夹</label>
            <input type="text" class="ald-folder-input" placeholder="留空为根目录" />
          </div>
          <div class="ald-preview">
            <img src="${imageUrl}" alt="预览" />
          </div>
        </div>
        <div class="ald-modal-footer">
          <button class="ald-btn ald-btn-cancel">取消</button>
          <button class="ald-btn ald-btn-primary">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    const close = () => overlay.remove();
    overlay.querySelector('.ald-modal-close').onclick = close;
    overlay.querySelector('.ald-btn-cancel').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    
    overlay.querySelector('.ald-btn-primary').onclick = () => {
      const tags = overlay.querySelector('.ald-tag-input').value
        .split(/[,，]/).map(t => t.trim()).filter(t => t);
      saveImageUrl(imageUrl, tags);
      close();
    };
    
    overlay.querySelector('.ald-tag-input').focus();
  }

  // ===== Toast 提示 =====
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `ald-toast ald-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // ===== 工具函数 =====
  // 解析图片最高清版本 URL（不点开原图即可获得高清图）
  function getBestImageUrl(img) {
    if (!img) return '';
    // 1. 常见懒加载 data 属性：很多网站把高清原图存在 data-* 里，src 只是占位/缩略图
    const dataAttrs = ['data-src','data-original','data-lazy-src','data-actualsrc','data-full','data-zoom-src','data-hi-res','data-original-src','data-large','data-big','data-echo','data-hi','data-original'];
    for (const attr of dataAttrs) {
      const v = img.getAttribute(attr);
      if (v && /^https?:\/\//i.test(v.trim())) return v.trim();
    }
    // 2. srcset：取最高分辨率（响应式图片）
    if (img.srcset) {
      const best = img.srcset.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean).pop();
      if (best) return best;
    }
    // 3. currentSrc：浏览器按视口实际选中的高清图
    if (img.currentSrc && /^https?:\/\//i.test(img.currentSrc)) return img.currentSrc;
    // 4. 清理常见缩略图后缀（保守，仅清理明确的缩略图标识）
    const src = img.currentSrc || img.src;
    if (src && !src.startsWith('data:')) {
      return getBestUrlFromString(src);
    }
    return src;
  }
  function getBestUrlFromString(url) {
    if (!url) return url;
    return url.replace(/[-_.](?:thumb|thumbnail|small|tiny|mini)(?=\.(?:jpe?g|png|webp|gif|bmp))/i, '');
  }
  function extractImageUrls(html) {
    const urls = [];
    const regex = /<img[^>]+src=["']([^"']+)["']/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      urls.push(match[1]);
    }
    return urls;
  }

  function updateBadge() {
    chrome.runtime.sendMessage({ type: 'GET_STATS' }, (response) => {
      if (response && response.success && dragButton) {
        const badge = dragButton.querySelector('.ald-badge');
        if (badge) badge.textContent = response.count;
      }
    });
  }

  // ===== 监听来自后台的消息 =====
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'SHOW_TAG_DIALOG') {
      showTagDialog(request.imageUrl);
      sendResponse({ success: true });
    }
    if (request.type === 'SHOW_TOAST') {
      showToast(request.message, request.type);
      sendResponse({ success: true });
    }
    if (request.type === 'GET_BEST_IMAGE_URL') {
      // 后台右键保存时询问页面内该图片的最高清 URL
      let url = request.srcUrl || '';
      if (url) {
        const imgs = Array.from(document.querySelectorAll('img'));
        const target = imgs.find(im => im.src === url || im.currentSrc === url);
        url = target ? getBestImageUrl(target) : getBestUrlFromString(url);
      }
      sendResponse({ success: true, url });
    }
  });

  // ===== 快捷键：Alt+S 保存当前页面所有图片 =====
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 's') {
      e.preventDefault();
      const images = Array.from(document.querySelectorAll('img'))
        .filter(img => img.naturalWidth > 100 && !img.src.startsWith('data:'))
        .slice(0, 20);
      
      if (images.length === 0) {
        showToast('当前页面没有找到合适的图片', 'info');
        return;
      }
      
      if (confirm(`找到 ${images.length} 张图片，是否全部保存到素材库？`)) {
        images.forEach((img, i) => {
          setTimeout(() => saveImageUrl(getBestImageUrl(img)), i * 300);
        });
        showToast(`正在保存 ${images.length} 张图片...`, 'info');
      }
    }
  });

  console.log('素材库扩展程序已注入当前页面');
})();
