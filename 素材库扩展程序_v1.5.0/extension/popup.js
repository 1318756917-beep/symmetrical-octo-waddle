// ===== 素材库扩展程序 - 弹窗逻辑 =====
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadRecentImages();

  document.getElementById('openLibraryBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_LIBRARY' });
    window.close();
  });

  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('viewAllBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_LIBRARY' });
    window.close();
  });
});

function loadStats() {
  chrome.runtime.sendMessage({ type: 'GET_STATS' }, (response) => {
    if (response && response.success) {
      document.getElementById('totalCount').textContent = response.count;
      document.getElementById('totalSize').textContent = formatSize(response.totalSize);
    }
  });

  chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
    if (response && response.success && response.config.cloudEnabled) {
      document.getElementById('cloudStatus').textContent = '云端';
      document.getElementById('cloudStatus').style.color = '#30a46c';
    }
  });
}

function loadRecentImages() {
  chrome.runtime.sendMessage({ type: 'GET_RECENT', count: 12 }, (response) => {
    const grid = document.getElementById('recentGrid');
    if (response && response.success && response.images.length > 0) {
      let html = '';
      response.images.forEach(img => {
        const src = img.blobData ? `data:${img.mimeType};base64,${img.blobData}` : (img.url || '');
        html += `
          <div class="recent-item" data-id="${img.id}" title="${escapeHtml(img.name)}">
            <img src="${src}" alt="${escapeHtml(img.name)}" loading="lazy">
            <div class="recent-overlay">
              <button class="recent-download" title="下载">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
              <button class="recent-delete" title="删除">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
        `;
      });
      grid.innerHTML = html;

      // 绑定事件
      grid.querySelectorAll('.recent-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.recent-download') || e.target.closest('.recent-delete')) return;
          // 打开大图
          const id = item.dataset.id;
          chrome.runtime.sendMessage({ type: 'GET_RECENT', count: 100 }, (resp) => {
            if (resp && resp.success) {
              const img = resp.images.find(i => i.id === id);
              if (img) {
                const src = img.blobData ? `data:${img.mimeType};base64,${img.blobData}` : img.url;
                chrome.tabs.create({ url: src });
              }
            }
          });
        });

        item.querySelector('.recent-download').addEventListener('click', (e) => {
          e.stopPropagation();
          const id = item.dataset.id;
          chrome.runtime.sendMessage({ type: 'GET_RECENT', count: 100 }, (resp) => {
            if (resp && resp.success) {
              const img = resp.images.find(i => i.id === id);
              if (img) {
                const src = img.blobData ? `data:${img.mimeType};base64,${img.blobData}` : img.url;
                chrome.downloads.download({ url: src, filename: img.name + '.' + getExt(img.mimeType) });
              }
            }
          });
        });

        item.querySelector('.recent-delete').addEventListener('click', (e) => {
          e.stopPropagation();
          const id = item.dataset.id;
          if (confirm('确定删除这张图片吗？')) {
            chrome.runtime.sendMessage({ type: 'DELETE_IMAGE', id }, () => {
              item.remove();
              loadStats();
            });
          }
        });
      });
    } else {
      grid.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="9" cy="9" r="2"/>
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
          </svg>
          <p>还没有收藏的图片</p>
          <p class="empty-hint">在任意网页右键图片保存</p>
        </div>
      `;
    }
  });
}

function formatSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function getExt(mimeType) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
  return map[mimeType] || 'png';
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
