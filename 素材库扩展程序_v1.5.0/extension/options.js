// ===== 素材库扩展程序 - 管理页面逻辑 =====
// ===== MV3 CSP 修复：全局事件委托替代内联 onclick/onkeydown 等 =====
(function(){
  const eventTypes=['click','dblclick','contextmenu','keydown','change','input','drop','dragover','dragenter','dragleave'];
  eventTypes.forEach(type=>{
    document.addEventListener(type,function(e){
      const target=e.target.closest('[on'+type+']');
      if(!target)return;
      const code=target.getAttribute('on'+type);
      if(!code)return;
      e.preventDefault();
      try{executeInline(code,target,e);}catch(err){console.error('内联事件执行失败:',code,err);}
    },true);
  });
  function executeInline(code,element,event){
    const stmts=splitStatements(code);
    stmts.forEach(s=>{if(s.trim())execStmt(s.trim(),element,event);});
  }
  function splitStatements(code){
    const result=[];let current='';let depth=0;let inStr=false;let strChar='';
    for(let i=0;i<code.length;i++){
      const c=code[i];
      if(inStr){current+=c;if(c===strChar&&code[i-1]!=='\\')inStr=false;continue;}
      if(c==="'"||c==='"'){inStr=true;strChar=c;current+=c;continue;}
      if(c==='{'||c==='('||c==='[')depth++;
      if(c==='}'||c===')'||c===']')depth--;
      if(c===';'&&depth===0){result.push(current);current='';}
      else current+=c;
    }
    if(current.trim())result.push(current);
    return result;
  }
  function execStmt(stmt,element,event){
    if(stmt.startsWith('if(')){
      const m=stmt.match(/^if\((.+)\)\{([\s\S]*)\}$/);
      if(m){if(evalExpr(m[1],element,event))executeInline(m[2],element,event);return;}
    }
    const fm=stmt.match(/^([a-zA-Z_$][\w$.]*)\(([\s\S]*)\)$/);
    if(fm){
      const fn=resolveFn(fm[1]);
      if(typeof fn==='function'){fn.apply(element,parseArgs(fm[2],element,event));}
      return;
    }
    const am=stmt.match(/^(this|[\w$]+(?:\.[\w$]+)*)\.([\w$]+)\s*=\s*(.+)$/);
    if(am){
      const obj=am[1]==='this'?element:resolveVar(am[1],element,event);
      if(obj)obj[am[2]]=evalExpr(am[3],element,event);
      return;
    }
  }
  function resolveFn(name){
    if(name.includes('.')){
      const parts=name.split('.');
      let obj=window;
      for(let i=0;i<parts.length-1;i++){obj=obj[parts[i]];if(!obj)return null;}
      return obj[parts[parts.length-1]];
    }
    return window[name];
  }
  function resolveVar(name,element,event){
    if(name==='this')return element;
    if(name==='event')return event;
    if(name.startsWith('this.'))return element[name.slice(5)];
    if(name.startsWith('event.'))return event[name.slice(6)];
    return window[name];
  }
  function parseArgs(str,element,event){
    if(!str.trim())return [];
    const args=[];let current='';let depth=0;let inStr=false;let strChar='';
    for(let i=0;i<str.length;i++){
      const c=str[i];
      if(inStr){current+=c;if(c===strChar&&str[i-1]!=='\\')inStr=false;continue;}
      if(c==="'"||c==='"'){inStr=true;strChar=c;current+=c;continue;}
      if(c==='('||c==='['||c==='{')depth++;
      if(c===')'||c===']'||c==='}')depth--;
      if(c===','&&depth===0){args.push(evalExpr(current.trim(),element,event));current='';}
      else current+=c;
    }
    if(current.trim())args.push(evalExpr(current.trim(),element,event));
    return args;
  }
  function evalExpr(expr,element,event){
    expr=expr.trim();
    if(!expr)return undefined;
    if((expr.startsWith("'")&&expr.endsWith("'"))||(expr.startsWith('"')&&expr.endsWith('"')))
      return expr.slice(1,-1).replace(/\\'/g,"'").replace(/\\"/g,'"');
    if(/^-?\d+(\.\d+)?$/.test(expr))return Number(expr);
    if(expr==='true')return true;if(expr==='false')return false;
    if(expr==='null')return null;if(expr==='undefined')return undefined;
    if(expr==='this')return element;if(expr==='event')return event;
    if(expr.startsWith('this.'))return element[expr.slice(5)];
    if(expr.startsWith('event.'))return event[expr.slice(6)];
    const cm=expr.match(/^(.+?)(===|!==|==|!=|>=|<=|>|<)(.+)$/);
    if(cm){
      const l=evalExpr(cm[1].trim(),element,event),r=evalExpr(cm[3].trim(),element,event);
      switch(cm[2]){case'===':return l===r;case'!==':return l!==r;case'==':return l==r;case'!=':return l!=r;case'>=':return l>=r;case'<=':return l<=r;case'>':return l>r;case'<':return l<r;}
    }
    const fm=expr.match(/^([a-zA-Z_$][\w$]*)\(([\s\S]*)\)$/);
    if(fm&&typeof window[fm[1]]==='function')return window[fm[1]].apply(null,parseArgs(fm[2],element,event));
    if(expr in window)return window[expr];
    return expr;
  }
})();

// ===== 扩展程序通信封装 =====
function sendMessage(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) { resolve({ success: false, error: chrome.runtime.lastError.message }); }
        else resolve(response);
      });
    } catch(e) { resolve({ success: false, error: e.message }); }
  });
}

async function updateAsset(id, updates) {
  const resp = await sendMessage({ type: 'UPDATE_IMAGE', id, updates });
  if (resp && resp.success) {
    const idx = state.assets.findIndex(a => a.id === id);
    if (idx >= 0) state.assets[idx] = { ...state.assets[idx], ...updates };
  }
  return resp;
}

async function batchUpdateAssets(ids, updates) {
  const resp = await sendMessage({ type: 'BATCH_UPDATE', ids, updates });
  if (resp && resp.success) {
    state.assets.forEach(a => { if (ids.includes(a.id)) Object.assign(a, updates); });
  }
  return resp;
}

// ===== 数据层 =====
let state={assets:[],folders:[],currentView:'all',currentFolderId:null,selectedIds:[],activeAssetId:null,searchQuery:'',colorFilter:null,tagFilter:null,expandedFolders:new Set(),editingFolderId:null,contextAssetId:null,vsResults:null,vsQueryImage:null,lbScale:1,lbTx:0,lbTy:0,lbDragging:false,lbStartX:0,lbStartY:0,lbMouseDownX:0,lbMouseDownY:0,currentLbAssetId:null};

const COLOR_PRESETS=[{name:'全部',hex:'all'},{name:'红色',hex:'#e5484d'},{name:'橙色',hex:'#f76b15'},{name:'黄色',hex:'#f5d90a'},{name:'绿色',hex:'#30a46c'},{name:'青色',hex:'#12a594'},{name:'蓝色',hex:'#3e63dd'},{name:'紫色',hex:'#8e4ec6'},{name:'粉色',hex:'#eb5e8a'},{name:'棕色',hex:'#8d5a2b'},{name:'灰色',hex:'#8a8a8a'}];

function loadFolders(){
  try{
    const s=localStorage.getItem('asset_library_folders_v1');
    if(s){state.folders=JSON.parse(s);}
  }catch(e){console.error(e);}
  if(state.folders.length===0){
    state.folders=[{id:genId(),name:'设计灵感',parentId:null,createdAt:Date.now()},{id:genId(),name:'UI 界面',parentId:null,createdAt:Date.now()},{id:genId(),name:'插画素材',parentId:null,createdAt:Date.now()}];
    saveFolders();
  }
}
function saveFolders(){try{localStorage.setItem('asset_library_folders_v1',JSON.stringify(state.folders));}catch(e){showToast('文件夹保存失败','error');}}

async function loadAllAssets(){
  document.getElementById('dbStatus').textContent='扩展程序：加载数据中...';
  const resp = await sendMessage({ type: 'GET_ALL' });
  if(resp && resp.success){
    state.assets = resp.images || [];
    document.getElementById('dbStatus').textContent=`扩展程序：已连接（${state.assets.length} 张图片）`;
  } else {
    document.getElementById('dbStatus').textContent='扩展程序：连接失败';
    showToast('无法连接扩展程序后台，请刷新页面','error');
  }
  updateCounts();
  renderAssets();
}

function genId(){return 'id_'+Date.now()+'_'+Math.random().toString(36).substr(2,9);}

// ===== 图片分析 =====
function getAssetSrc(asset){
  if(asset.blobData) return `data:${asset.mimeType||'image/png'};base64,${asset.blobData}`;
  if(asset.url&&asset.url.startsWith('http'))return asset.url;
  return '';
}

function analyzeImage(asset){return new Promise(resolve=>{const img=new Image();img.crossOrigin='anonymous';img.onload=function(){try{const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=50;canvas.height=50;ctx.drawImage(img,0,0,50,50);const px=ctx.getImageData(0,0,50,50).data,cm={};for(let i=0;i<px.length;i+=4){const r=Math.round(px[i]/32)*32,g=Math.round(px[i+1]/32)*32,b=Math.round(px[i+2]/32)*32;const k=r+','+g+','+b;cm[k]=(cm[k]||0)+1;}asset.colors=Object.entries(cm).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k])=>{const[r,g,b]=k.split(',').map(Number);return rgbToHex(r,g,b);});canvas.width=9;canvas.height=8;ctx.drawImage(img,0,0,9,8);const sd=ctx.getImageData(0,0,9,8).data;let hash='';for(let y=0;y<8;y++)for(let x=0;x<8;x++){const i=(y*9+x)*4,l=(sd[i]+sd[i+1]+sd[i+2])/3;const j=(y*9+x+1)*4,r=(sd[j]+sd[j+1]+sd[j+2])/3;hash+=l>r?'1':'0';}asset.phash=hash;asset.width=img.naturalWidth;asset.height=img.naturalHeight;}catch(e){}resolve();};img.onerror=()=>resolve();const src = getAssetSrc(asset);if(src)img.src=src;else resolve();});}

function hammingDistance(h1,h2){if(!h1||!h2||h1.length!==h2.length)return 64;let d=0;for(let i=0;i<h1.length;i++)if(h1[i]!==h2[i])d++;return d;}
function rgbToHex(r,g,b){return '#'+[r,g,b].map(x=>{const h=x.toString(16);return h.length===1?'0'+h:h;}).join('');}
function hexToRgb(hex){const r=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);return r?{r:parseInt(r[1],16),g:parseInt(r[2],16),b:parseInt(r[3],16)}:null;}
function colorDistance(h1,h2){const c1=hexToRgb(h1),c2=hexToRgb(h2);if(!c1||!c2)return Infinity;return Math.sqrt(Math.pow(c1.r-c2.r,2)+Math.pow(c1.g-c2.g,2)+Math.pow(c1.b-c2.b,2));}

// ===== 视图 =====
function switchView(view){state.currentView=view;state.currentFolderId=null;state.selectedIds=[];state.activeAssetId=null;state.colorFilter=null;state.tagFilter=null;state.vsResults=null;document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===view));updateBreadcrumb();renderColorPalette();renderTagFilter();renderAssets();updateSelectionBar();}
function selectFolder(folderId){state.currentView='folder';state.currentFolderId=folderId;state.selectedIds=[];state.activeAssetId=null;state.colorFilter=null;state.tagFilter=null;state.vsResults=null;document.querySelectorAll('.nav-item').forEach(el=>el.classList.remove('active'));updateBreadcrumb();renderFolderTree();renderColorPalette();renderTagFilter();renderAssets();updateSelectionBar();}
function updateBreadcrumb(){const bc=document.getElementById('breadcrumb');let h='';if(state.currentView==='all')h='<span class="crumb current">全部素材</span>';else if(state.currentView==='recent')h='<span class="crumb current">最近添加</span>';else if(state.currentView==='favorites')h='<span class="crumb current">收藏</span>';else if(state.currentView==='trash')h='<span class="crumb current">回收站</span>';else if(state.currentView==='folder'){const p=getFolderPath(state.currentFolderId);h='<span class="crumb" onclick="switchView(\'all\')">全部素材</span>';p.forEach((f,i)=>{h+='<span class="sep">/</span>';h+=i===p.length-1?`<span class="crumb current">${escapeHtml(f.name)}</span>`:`<span class="crumb" onclick="selectFolder('${f.id}')">${escapeHtml(f.name)}</span>`;});}bc.innerHTML=h;}
function getFolderPath(fid){const p=[];let c=state.folders.find(f=>f.id===fid);while(c){p.unshift(c);c=c.parentId?state.folders.find(f=>f.id===c.parentId):null;}return p;}
function renderFolderTree(){document.getElementById('folderTree').innerHTML=renderFolderNodes(null);}
function renderFolderNodes(pid){const fs=state.folders.filter(f=>f.parentId===pid);if(!fs.length)return '';let h='';fs.forEach(f=>{const ch=state.folders.filter(c=>c.parentId===f.id),ex=state.expandedFolders.has(f.id),ac=state.currentFolderId===f.id&&state.currentView==='folder',cnt=getAssetsInFolder(f.id).length;h+=`<div class="folder-node ${ex?'expanded':''} ${ac?'active':''}" data-folder-id="${f.id}" onclick="selectFolder('${f.id}')"><span class="toggle ${ch.length?'':'empty'}" onclick="event.stopPropagation();toggleFolder('${f.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span><svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span class="folder-name">${escapeHtml(f.name)}</span><span style="font-size:10.5px;color:var(--text-muted);">${cnt}</span><div class="folder-actions"><button onclick="event.stopPropagation();openFolderModal('${f.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button><button onclick="event.stopPropagation();deleteFolder('${f.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div></div>`;if(ex&&ch.length)h+=`<div class="folder-children">${renderFolderNodes(f.id)}</div>`;});return h;}
function toggleFolder(id){state.expandedFolders.has(id)?state.expandedFolders.delete(id):state.expandedFolders.add(id);renderFolderTree();}
function getAssetsInFolder(fid){const ids=[fid];const gc=p=>{state.folders.filter(f=>f.parentId===p).forEach(f=>{ids.push(f.id);gc(f.id);});};gc(fid);return state.assets.filter(a=>!a.deleted&&ids.includes(a.folderId));}
function renderColorPalette(){let h='';COLOR_PRESETS.forEach(c=>{const a=state.colorFilter===c.hex;h+=c.hex==='all'?`<div class="color-swatch all ${a?'active':''}" onclick="setColorFilter(null)" title="全部颜色"></div>`:`<div class="color-swatch ${a?'active':''}" style="background:${c.hex}" onclick="setColorFilter('${c.hex}')" title="${c.name}"></div>`;});document.getElementById('colorPalette').innerHTML=h;}
function setColorFilter(h){state.colorFilter=h;renderColorPalette();renderAssets();}
function renderTagFilter(){const all=new Set();getFilteredAssets(false).forEach(a=>a.tags.forEach(t=>all.add(t)));const tags=Array.from(all).slice(0,12);let h='';tags.forEach(t=>{const a=state.tagFilter===t;h+=`<span class="tag-chip ${a?'active':''}" onclick="setTagFilter('${escapeHtml(t)}')">${escapeHtml(t)}</span>`;});if(!tags.length)h='<span style="font-size:11px;color:var(--text-muted);">暂无标签</span>';document.getElementById('tagFilter').innerHTML=h;}
function setTagFilter(t){state.tagFilter=state.tagFilter===t?null:t;renderTagFilter();renderAssets();}
function getFilteredAssets(af=true){let a=state.assets.filter(x=>state.currentView==='trash'?x.deleted:!x.deleted);if(state.currentView==='folder'&&state.currentFolderId){const ids=new Set(getAssetsInFolder(state.currentFolderId).map(x=>x.id));a=a.filter(x=>ids.has(x.id));}if(state.currentView==='favorites')a=a.filter(x=>x.favorite);if(state.currentView==='recent'){const w=Date.now()-7*86400000;a=a.filter(x=>x.createdAt>=w);}if(af){if(state.searchQuery){const q=state.searchQuery.toLowerCase();a=a.filter(x=>x.name.toLowerCase().includes(q)||(x.description&&x.description.toLowerCase().includes(q))||x.tags.some(t=>t.toLowerCase().includes(q)));}if(state.colorFilter)a=a.filter(x=>x.colors&&x.colors.some(c=>colorDistance(c,state.colorFilter)<80));if(state.tagFilter)a=a.filter(x=>x.tags.includes(state.tagFilter));}if(state.vsResults){const ids=new Set(state.vsResults.map(r=>r.id));a=a.filter(x=>ids.has(x.id));a.sort((x,y)=>{const rx=state.vsResults.find(r=>r.id===x.id),ry=state.vsResults.find(r=>r.id===y.id);return(rx?rx.similarity:0)-(ry?ry.similarity:0);});}else{const s=document.getElementById('sortSelect').value;switch(s){case'newest':a.sort((x,y)=>y.createdAt-x.createdAt);break;case'oldest':a.sort((x,y)=>x.createdAt-y.createdAt);break;case'name':a.sort((x,y)=>x.name.localeCompare(y.name));break;case'size':a.sort((x,y)=>y.size-x.size);break;}}return a;}

// ===== 素材渲染 =====
function renderAssets(){
  const grid=document.getElementById('assetGrid'),empty=document.getElementById('emptyState'),assets=getFilteredAssets();
  document.getElementById('contentStats').textContent=state.vsResults?`找到 ${assets.length} 张相似图片`:`${assets.length} 张图片`;
  if(!assets.length){grid.style.display='none';empty.style.display='flex';
    if(state.vsResults){document.getElementById('emptyTitle').textContent='没有找到相似图片';document.getElementById('emptyDesc').textContent='尝试使用其他图片搜索';}
    else if(state.currentView==='trash'){document.getElementById('emptyTitle').textContent='回收站是空的';document.getElementById('emptyDesc').textContent='删除的图片会暂时保存在这里';}
    else if(state.searchQuery||state.colorFilter||state.tagFilter){document.getElementById('emptyTitle').textContent='没有找到匹配的素材';document.getElementById('emptyDesc').textContent='尝试调整搜索关键词或筛选条件';}
    else{document.getElementById('emptyTitle').textContent='还没有素材';document.getElementById('emptyDesc').textContent='在任意网页右键图片保存到素材库，或点击右上角「上传图片」';}
    return;}
  grid.style.display='grid';empty.style.display='none';
  let h='';assets.forEach(a=>{
    const sel=state.selectedIds.includes(a.id),vsr=state.vsResults?state.vsResults.find(r=>r.id===a.id):null;
    const ch=(a.colors||[]).slice(0,3).map(c=>`<div class="asset-color-dot" style="background:${c}"></div>`).join('');
    const tg=(a.tags||[]).slice(0,3).map(t=>`<span class="asset-tag-mini">${escapeHtml(t)}</span>`).join('');
    const isHd=a.width>=1200||(a.blobData&&a.width>=1200);
    const src=getAssetSrc(a);
    h+=`<div class="asset-card ${sel?'selected':''}" data-id="${a.id}" draggable="true" ondblclick="openLightbox('${a.id}')" oncontextmenu="showContextMenu(event,'${a.id}')">
      <div class="asset-checkbox" title="多选">${sel?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>':''}</div>
      ${vsr?`<div class="similarity-badge">${Math.round((1-vsr.similarity/64)*100)}%</div>`:''}
      ${isHd?'<div class="hd-badge">HD</div>':''}
      <div class="asset-thumb">
        ${src?`<img src="${src}" alt="${escapeHtml(a.name)}" loading="lazy">`:`<div class="loading"><div class="spin"></div>加载中...</div>`}
        <div class="asset-overlay"><div class="asset-tags-overlay">${tg}</div></div>
        <div class="asset-colors">${ch}</div>
        ${a.favorite?'<div style="position:absolute;top:8px;right:8px;color:#f59e0b;"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>':''}
      </div>
      <div class="asset-info"><div class="asset-name">${escapeHtml(a.name)}</div><div class="asset-meta"><span>${formatFileSize(a.size)}</span>${a.width?`<span>${a.width}×${a.height}</span>`:''}</div></div>
    </div>`;
  });
  grid.innerHTML=h;
}
let selectClickTimer=null;
function selectAsset(id,event){
  // 点击图片任意位置即切换多选；延迟 250ms 以区分双击（双击打开大图，不触发多选）
  if(selectClickTimer){
    clearTimeout(selectClickTimer);
    selectClickTimer=null;
    return; // 第二次点击（双击），取消第一次的多选切换，由 dblclick 打开大图
  }
  selectClickTimer=setTimeout(()=>{
    selectClickTimer=null;
    toggleSelect(id);
  },250);
}
function toggleSelect(id){
  const i=state.selectedIds.indexOf(id);
  i>-1?state.selectedIds.splice(i,1):state.selectedIds.push(id);
  // 恰好选中一张时显示其属性面板，否则清空
  state.activeAssetId=state.selectedIds.length===1?state.selectedIds[0]:null;
  renderAssets();renderPanel();updateSelectionBar();
}
function clearSelection(){state.selectedIds=[];state.activeAssetId=null;if(selectClickTimer){clearTimeout(selectClickTimer);selectClickTimer=null;}renderAssets();renderPanel();updateSelectionBar();}
function updateSelectionBar(){const bar=document.getElementById('selectionBar');if(state.selectedIds.length>0){bar.classList.add('show');document.getElementById('selectionCount').textContent=`已选择 ${state.selectedIds.length} 项`;}else bar.classList.remove('show');}

// ===== 属性面板 =====
function renderPanel(){
  const body=document.getElementById('panelBody');
  if(!state.activeAssetId){body.innerHTML=`<div class="panel-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg><p>选择一张图片查看属性</p></div>`;return;}
  const a=state.assets.find(x=>x.id===state.activeAssetId);if(!a)return;
  const ch=(a.colors||[]).map(c=>`<div class="panel-color"><div class="swatch" style="background:${c}"></div><span class="hex">${c.toUpperCase()}</span></div>`).join('');
  const tg=(a.tags||[]).map((t,i)=>`<span class="panel-tag">${escapeHtml(t)}<button onclick="removeTag('${a.id}',${i})">&times;</button></span>`).join('');
  const fn=a.folderId?(state.folders.find(f=>f.id===a.folderId)?.name||'未分类'):'未分类';
  const src=getAssetSrc(a);
  body.innerHTML=`<div class="panel-preview" id="panelPreview" onclick="openLightbox('${a.id}')">${src?`<img src="${src}" alt="${escapeHtml(a.name)}">`:'<div class="loading"><div class="spin"></div>加载中...</div>'}</div>
    <div class="panel-field"><label>名称</label><input type="text" value="${escapeHtml(a.name)}" onchange="updateAssetField('${a.id}','name',this.value)"></div>
    <div class="panel-field"><label>描述</label><textarea placeholder="添加描述..." onchange="updateAssetField('${a.id}','description',this.value)">${escapeHtml(a.description||'')}</textarea></div>
    <div class="panel-field"><label>标签</label><div class="panel-tags">${tg}</div><div class="tag-input-row"><input type="text" id="newTagInput" placeholder="输入标签后按回车" onkeydown="if(event.key==='Enter'){addTag('${a.id}',this.value);this.value='';}"><button class="btn btn-secondary btn-sm" onclick="const inp=document.getElementById('newTagInput');addTag('${a.id}',inp.value);inp.value='';">添加</button></div></div>
    <div class="panel-field"><label>主色调</label><div class="panel-colors">${ch||'<span style="font-size:12px;color:var(--text-muted);">分析中...</span>'}</div></div>
    <div class="panel-field"><label>文件信息</label><div class="field-value"><div>文件夹：${escapeHtml(fn)}</div>${a.width?`<div>尺寸：${a.width}×${a.height} ${a.width>=1200?'<span style="color:#4ade80;">(高清)</span>':''}</div>`:''}<div>大小：${formatFileSize(a.size)}</div><div>存储：${a.blobData?'<span style="color:var(--accent);">扩展数据库</span>':'<span style="color:var(--text-muted);">网络URL</span>'}</div><div>添加时间：${formatDate(a.createdAt)}</div>${a.source?`<div>来源：${escapeHtml(a.source)}</div>`:''}${a.pageUrl?`<div>来源网页：<a href="${a.pageUrl}" target="_blank" style="color:var(--accent);">查看</a></div>`:''}</div></div>
    <div class="panel-actions"><button class="btn btn-secondary btn-sm" onclick="downloadAsset('${a.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>下载原图</button><button class="btn ${a.favorite?'btn-primary':'btn-secondary'} btn-sm" onclick="toggleFavorite('${a.id}')"><svg viewBox="0 0 24 24" fill="${a.favorite?'currentColor':'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>${a.favorite?'已收藏':'收藏'}</button></div>
    <div class="panel-actions" style="padding-top:0;"><button class="btn btn-secondary btn-sm" onclick="reverseSearchAsset('${a.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6M8 11h6"/></svg>以图识图</button></div>
    ${state.currentView==='trash'?`<div class="panel-actions" style="padding-top:0;"><button class="btn btn-secondary btn-sm" onclick="restoreAsset('${a.id}')">恢复</button><button class="btn btn-danger btn-sm" onclick="permanentDelete('${a.id}')">永久删除</button></div>`:''}`;
}
function closePanel(){state.activeAssetId=null;state.selectedIds=[];renderAssets();renderPanel();updateSelectionBar();}
function updateAssetField(id,f,v){const a=state.assets.find(x=>x.id===id);if(a){a[f]=v;updateAsset(id,{[f]:v});renderAssets();}}
function addTag(id,t){t=t.trim();if(!t)return;const a=state.assets.find(x=>x.id===id);if(a&&!a.tags.includes(t)){a.tags.push(t);updateAsset(id,{tags:a.tags});renderPanel();renderAssets();renderTagFilter();}}
function removeTag(id,i){const a=state.assets.find(x=>x.id===id);if(a&&a.tags){a.tags.splice(i,1);updateAsset(id,{tags:a.tags});renderPanel();renderAssets();renderTagFilter();}}
function toggleFavorite(id){const a=state.assets.find(x=>x.id===id);if(a){a.favorite=!a.favorite;updateAsset(id,{favorite:a.favorite});renderPanel();renderAssets();updateCounts();}}

// ===== 文件上传 =====
function handleFileUpload(event){const files=event.target.files;if(!files||!files.length)return;Array.from(files).forEach(f=>{if(!f.type.startsWith('image/')){showToast(`${f.name} 不是图片文件`,'error');return;}importImageFile(f);});event.target.value='';}
async function importImageFile(file){
  showToast(`正在导入 ${file.name}...`,'info');
  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result.split(',')[1];
    const folderId = state.currentView==='folder'?state.currentFolderId:null;
    const resp = await sendMessage({ type:'SAVE_IMAGE_BLOB', blobData:base64, mimeType:file.type, name:file.name, pageUrl:'本地上传', tags:[], folderId });
    if(resp && resp.success && resp.asset){
      // 先加载所有数据
      await loadAllAssets();
      // 分析图片宽高、颜色、phash
      const asset = state.assets.find(a=>a.id===resp.asset.id);
      if(asset){
        await analyzeImage(asset);
        await updateAsset(asset.id, { width: asset.width, height: asset.height, colors: asset.colors, phash: asset.phash });
        showToast(`已导入 ${file.name}（${asset.width}×${asset.height}）`,'success');
      } else {
        showToast(`已导入 ${file.name}`,'success');
      }
      renderAssets();
      renderColorPalette();
      renderTagFilter();
    } else {
      showToast('导入失败: ' + (resp?.error || '未知错误'),'error');
    }
  };
  reader.readAsDataURL(file);
}

// ===== URL导入 =====
function parseUrls(text){return text.split(/[\n\r\s,，]+/).map(u=>u.trim()).filter(u=>/^https?:\/\//i.test(u));}
function openImportModal(){const sel=document.getElementById('importFolder');let o='<option value="">根目录</option>';state.folders.forEach(f=>o+=`<option value="${f.id}">${escapeHtml(f.name)}</option>`);sel.innerHTML=o;document.getElementById('importUrl').value='';document.getElementById('importTags').value='';showModal('importModal');}
async function importFromUrl(){const text=document.getElementById('importUrl').value.trim(),folderId=document.getElementById('importFolder').value||null,tagsStr=document.getElementById('importTags').value.trim();if(!text){showToast('请输入图片 URL','error');return;}const urls=parseUrls(text);if(!urls.length){showToast('未识别到有效的图片 URL','error');return;}const tags=tagsStr?tagsStr.split(/[,，]/).map(t=>t.trim()).filter(t=>t):[];closeModal('importModal');showToast(`正在导入 ${urls.length} 张图片...`,'info');for(let i=0;i<urls.length;i++){await sendMessage({type:'SAVE_IMAGE',imageUrl:urls[i],pageUrl:'URL导入',pageTitle:'',tags,folderId});}await loadAllAssets();// 分析新导入的图片（没有phash的）
  const needAnalyze = state.assets.filter(a=>!a.phash && a.blobData);
  for(let i=0;i<needAnalyze.length;i++){
    await analyzeImage(needAnalyze[i]);
    await updateAsset(needAnalyze[i].id,{width:needAnalyze[i].width,height:needAnalyze[i].height,colors:needAnalyze[i].colors,phash:needAnalyze[i].phash});
  }
  renderAssets();renderColorPalette();renderTagFilter();
  showToast(`成功导入 ${urls.length} 张图片`,'success');}

// ===== 文件夹管理 =====
function openFolderModal(editId=null){state.editingFolderId=editId;const title=document.getElementById('folderModalTitle'),ni=document.getElementById('folderName'),pg=document.getElementById('parentFolderGroup'),ps=document.getElementById('parentFolder');if(editId){const f=state.folders.find(x=>x.id===editId);title.textContent='重命名文件夹';ni.value=f.name;pg.style.display='none';}else{title.textContent='新建文件夹';ni.value='';pg.style.display='block';let o='<option value="">根目录</option>';state.folders.forEach(f=>o+=`<option value="${f.id}" ${state.currentFolderId===f.id?'selected':''}>${escapeHtml(f.name)}</option>`);ps.innerHTML=o;}showModal('folderModal');setTimeout(()=>ni.focus(),100);}
function saveFolder(){const name=document.getElementById('folderName').value.trim();if(!name){showToast('请输入文件夹名称','error');return;}if(state.editingFolderId){const f=state.folders.find(x=>x.id===state.editingFolderId);if(f){f.name=name;saveFolders();renderFolderTree();updateBreadcrumb();showToast('文件夹已重命名','success');}}else{const pid=document.getElementById('parentFolder').value||null;state.folders.push({id:genId(),name,parentId:pid,createdAt:Date.now()});if(pid)state.expandedFolders.add(pid);saveFolders();renderFolderTree();showToast('文件夹已创建','success');}closeModal('folderModal');}
function deleteFolder(fid){const f=state.folders.find(x=>x.id===fid);if(!f)return;const hasCh=state.folders.some(x=>x.parentId===fid),assets=getAssetsInFolder(fid);const msg=hasCh?`文件夹「${f.name}」包含子文件夹和 ${assets.length} 张图片，确定删除吗？`:`确定删除文件夹「${f.name}」吗？其中 ${assets.length} 张图片将移到回收站。`;if(!confirm(msg))return;const ids=[fid];const gc=p=>{state.folders.filter(x=>x.parentId===p).forEach(x=>{ids.push(x.id);gc(x.id);});};gc(fid);state.folders=state.folders.filter(x=>!ids.includes(x.id));const assetIds=state.assets.filter(a=>ids.includes(a.folderId)).map(a=>a.id);if(assetIds.length)batchUpdateAssets(assetIds,{deleted:true,folderId:null});if(state.currentView==='folder'&&ids.includes(state.currentFolderId))switchView('all');saveFolders();renderFolderTree();renderAssets();updateCounts();showToast('文件夹已删除','success');}

// ===== 右键菜单 =====
function showContextMenu(event,id){event.preventDefault();state.contextAssetId=id;const menu=document.getElementById('contextMenu');menu.style.left=event.pageX+'px';menu.style.top=event.pageY+'px';menu.classList.add('show');}
document.addEventListener('click',()=>document.getElementById('contextMenu').classList.remove('show'));
function actionDownload(){if(state.contextAssetId)downloadAsset(state.contextAssetId);}
function actionCopyUrl(){const a=state.assets.find(x=>x.id===state.contextAssetId);if(a){const src=getAssetSrc(a);if(src)navigator.clipboard.writeText(src).then(()=>showToast('图片地址已复制','success')).catch(()=>showToast('复制失败','error'));}}
function actionReverseSearch(){if(state.contextAssetId)reverseSearchAsset(state.contextAssetId);}
function actionToggleFavorite(){if(state.contextAssetId)toggleFavorite(state.contextAssetId);}
function actionMoveTo(){if(!state.contextAssetId)return;const name=prompt('输入目标文件夹名称（留空则移到根目录）：');if(name===null)return;let fid=null;if(name.trim()){let f=state.folders.find(x=>x.name===name.trim());if(!f){f={id:genId(),name:name.trim(),parentId:null,createdAt:Date.now()};state.folders.push(f);saveFolders();renderFolderTree();showToast(`已创建文件夹「${name.trim()}」`,'info');}fid=f.id;}updateAsset(state.contextAssetId,{folderId:fid});renderAssets();showToast('已移动到目标文件夹','success');}
function actionDelete(){if(state.contextAssetId)deleteAsset(state.contextAssetId);}
async function downloadAsset(id){const a=state.assets.find(x=>x.id===id);if(!a)return;const src=getAssetSrc(a);if(!src){showToast('图片加载失败','error');return;}const el=document.createElement('a');el.href=src;el.download=a.name+'.'+(a.mimeType?.includes('png')?'png':'jpg');document.body.appendChild(el);el.click();document.body.removeChild(el);showToast('开始下载高清原图','success');}
function deleteAsset(id){const a=state.assets.find(x=>x.id===id);if(a){updateAsset(id,{deleted:true});if(state.activeAssetId===id)closePanel();showToast('已移到回收站','success');}}
function restoreAsset(id){updateAsset(id,{deleted:false});if(state.activeAssetId===id)renderPanel();showToast('已恢复','success');}
async function permanentDelete(id){if(!confirm('确定永久删除这张图片吗？此操作不可恢复。'))return;await sendMessage({type:'DELETE_IMAGE',id});state.assets=state.assets.filter(x=>x.id!==id);renderAssets();updateCounts();closePanel();showToast('已永久删除','success');}
function batchDownload(){state.selectedIds.forEach((id,i)=>setTimeout(()=>downloadAsset(id),i*300));}
function batchMove(){const name=prompt(`将 ${state.selectedIds.length} 张图片移动到文件夹（输入名称，留空为根目录）：`);if(name===null)return;const count=state.selectedIds.length;let fid=null;if(name.trim()){let f=state.folders.find(x=>x.name===name.trim());if(!f){f={id:genId(),name:name.trim(),parentId:null,createdAt:Date.now()};state.folders.push(f);saveFolders();renderFolderTree();}fid=f.id;}batchUpdateAssets(state.selectedIds,{folderId:fid});clearSelection();showToast(`已移动 ${count} 张图片`,'success');}
function batchDelete(){if(!confirm(`确定将 ${state.selectedIds.length} 张图片移到回收站吗？`))return;batchUpdateAssets(state.selectedIds,{deleted:true});clearSelection();showToast('已移到回收站','success');}

// ===== 大图查看器 =====
function openLightbox(id){const a=state.assets.find(x=>x.id===id);if(!a)return;
  if(selectClickTimer){clearTimeout(selectClickTimer);selectClickTimer=null;}
  state.currentLbAssetId=id;state.lbScale=1;state.lbTx=0;state.lbTy=0;const src=getAssetSrc(a);document.getElementById('lightboxImg').src=src||'';document.getElementById('lbInfo').textContent=`${a.name}${a.width?` · ${a.width}×${a.height}`:''}${a.size?` · ${formatFileSize(a.size)}`:''}`;document.getElementById('lbZoomDisplay').textContent='100%';updateLbTransform();document.getElementById('lightbox').classList.add('show');}
function closeLightbox(event){if(event&&event.target.tagName==='IMG')return;document.getElementById('lightbox').classList.remove('show');}
function updateLbTransform(){const img=document.getElementById('lightboxImg');img.style.transform=`translate(${state.lbTx}px,${state.lbTy}px) scale(${state.lbScale})`;document.getElementById('lbZoomDisplay').textContent=Math.round(state.lbScale*100)+'%';}
function zoomLightbox(factor){state.lbScale=Math.max(0.1,Math.min(10,state.lbScale*factor));updateLbTransform();}
function resetLightboxZoom(){state.lbScale=1;state.lbTx=0;state.lbTy=0;updateLbTransform();}
function downloadCurrentLb(){if(state.currentLbAssetId)downloadAsset(state.currentLbAssetId);}
let lbClickTimer=null;
function initLightboxEvents(){
  const container=document.getElementById('lbContainer');
  const lightbox=document.getElementById('lightbox');
  container.addEventListener('wheel',e=>{e.preventDefault();const factor=e.deltaY>0?0.9:1.1;const newScale=Math.max(0.1,Math.min(10,state.lbScale*factor));const rect=container.getBoundingClientRect();const mx=e.clientX-rect.left-rect.width/2,my=e.clientY-rect.top-rect.height/2;state.lbTx=mx-(mx-state.lbTx)*(newScale/state.lbScale);state.lbTy=my-(my-state.lbTy)*(newScale/state.lbScale);state.lbScale=newScale;updateLbTransform();},{passive:false});
  // 在 lightbox 整个覆盖层按下：支持拖拽平移 + 单击任意区域关闭（排除工具栏/关闭按钮）
  lightbox.addEventListener('mousedown',e=>{
    if(e.target.closest('button'))return;
    state.lbMouseDownX=e.clientX;state.lbMouseDownY=e.clientY;
    state.lbDragging=true;
    state.lbStartX=e.clientX-state.lbTx;state.lbStartY=e.clientY-state.lbTy;
    container.classList.add('dragging');
  });
  document.addEventListener('mousemove',e=>{if(state.lbDragging){state.lbTx=e.clientX-state.lbStartX;state.lbTy=e.clientY-state.lbStartY;updateLbTransform();}});
  document.addEventListener('mouseup',e=>{
    if(!state.lbDragging)return;
    state.lbDragging=false;
    container.classList.remove('dragging');
    const dx=e.clientX-state.lbMouseDownX,dy=e.clientY-state.lbMouseDownY;
    if(Math.abs(dx)<5&&Math.abs(dy)<5){
      // 单击：延迟关闭以区分双击放大
      if(lbClickTimer){clearTimeout(lbClickTimer);lbClickTimer=null;return;}
      lbClickTimer=setTimeout(()=>{lbClickTimer=null;closeLightbox();},250);
    }
  });
  container.addEventListener('dblclick',e=>{if(state.lbScale>1)resetLightboxZoom();else{state.lbScale=2.5;const rect=container.getBoundingClientRect();state.lbTx=(e.clientX-rect.left-rect.width/2)*-1.5;state.lbTy=(e.clientY-rect.top-rect.height/2)*-1.5;updateLbTransform();}});
}

// ===== 以图识图 =====
function openReverseSearch(){state.vsResults=null;state.vsQueryImage=null;document.getElementById('vsModalBody').innerHTML=`<div class="vs-upload-area" id="vsUploadArea" onclick="document.getElementById('vsFileInput').click()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6M8 11h6"/></svg><div class="vs-title">上传图片搜索相似素材</div><div class="vs-desc">点击选择 / 拖拽图片 / Ctrl+V 粘贴</div></div><input type="file" id="vsFileInput" accept="image/*" style="display:none" onchange="handleVsUpload(event)">`;showModal('vsModal');setupVsDragDrop();}
function setupVsDragDrop(){const area=document.getElementById('vsUploadArea');if(!area)return;['dragenter','dragover'].forEach(evt=>area.addEventListener(evt,e=>{e.preventDefault();e.stopPropagation();area.classList.add('dragover');}));['dragleave','drop'].forEach(evt=>area.addEventListener(evt,e=>{e.preventDefault();e.stopPropagation();area.classList.remove('dragover');}));area.addEventListener('drop',e=>{const files=e.dataTransfer.files;if(files.length>0)processVsImage(files[0]);});}
function handleVsUpload(event){const f=event.target.files[0];if(f)processVsImage(f);event.target.value='';}
function processVsImage(file){const reader=new FileReader();reader.onload=e=>{state.vsQueryImage=e.target.result;doReverseSearch(e.target.result);};reader.readAsDataURL(file);}
function doReverseSearch(imageUrl){document.getElementById('vsModalBody').innerHTML=`<div class="vs-loading"><div class="vs-spinner"></div><p>正在分析图片并搜索相似素材...</p></div>`;const img=new Image();img.onload=function(){const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=9;canvas.height=8;ctx.drawImage(img,0,0,9,8);const data=ctx.getImageData(0,0,9,8).data;let qh='';for(let y=0;y<8;y++)for(let x=0;x<8;x++){const i=(y*9+x)*4,l=(data[i]+data[i+1]+data[i+2])/3;const j=(y*9+x+1)*4,r=(data[j]+data[j+1]+data[j+2])/3;qh+=l>r?'1':'0';}const search=state.assets.filter(a=>!a.deleted);const need=search.filter(a=>!a.phash);const run=()=>{const results=search.filter(a=>a.phash).map(a=>({id:a.id,similarity:hammingDistance(qh,a.phash)})).filter(r=>r.similarity<=20).sort((a,b)=>a.similarity-b.similarity).slice(0,30);state.vsResults=results;closeModal('vsModal');switchView('all');renderAssets();if(results.length>0)showToast(`找到 ${results.length} 张相似图片`,'success');else{showToast('没有找到相似图片','info');state.vsResults=null;renderAssets();}};if(need.length>0){let d=0;need.forEach((a,idx)=>setTimeout(()=>{analyzeImage(a).then(()=>{d++;if(d>=need.length)run();});},idx*100));}else run();};img.onerror=function(){showToast('图片加载失败，请重试','error');openReverseSearch();};img.src=imageUrl;}
async function reverseSearchAsset(id){const a=state.assets.find(x=>x.id===id);if(!a)return;if(!a.phash){showToast('正在分析图片...','info');await analyzeImage(a);updateAsset(id,{phash:a.phash,colors:a.colors});}if(!a.phash){showToast('图片分析失败','error');return;}const results=state.assets.filter(x=>!x.deleted&&x.id!==id&&x.phash).map(x=>({id:x.id,similarity:hammingDistance(a.phash,x.phash)})).filter(r=>r.similarity<=20).sort((x,y)=>x.similarity-y.similarity).slice(0,30);state.vsResults=results;switchView('all');renderAssets();if(results.length>0)showToast(`找到 ${results.length} 张相似图片`,'success');else{showToast('没有找到相似图片','info');state.vsResults=null;renderAssets();}}

// ===== 云端/设置 =====
function openCloudModal(){document.getElementById('cloudAssetCount').textContent=state.assets.length;document.getElementById('cloudFolderCount').textContent=state.folders.length;sendMessage({type:'GET_CONFIG'}).then(resp=>{if(resp&&resp.success){const c=resp.config;document.getElementById('storageMode').value=c.cloudProvider==='github'?'github':c.cloudProvider==='custom'?'custom':'local';document.getElementById('githubRepo').value=c.githubRepo||'';document.getElementById('githubToken').value=c.githubToken||'';document.getElementById('githubBranch').value=c.githubBranch||'main';document.getElementById('apiUrl').value=c.apiUrl||'';document.getElementById('apiKey').value=c.apiKey||'';document.getElementById('cfgShowDragBtn').checked=c.showDragBtn!==false;toggleStorageMode();loadPagesStatus();}});showModal('cloudModal');}
function toggleStorageMode(){const mode=document.getElementById('storageMode').value;document.getElementById('githubConfig').style.display=mode==='github'?'block':'none';document.getElementById('customConfig').style.display=mode==='custom'?'block':'none';}
// ===== GitHub Pages 状态与操作 =====
// 使用当前输入框中的配置（无需先保存设置）
function currentGithubConfig(){
  return {
    cloudEnabled: true,
    cloudProvider: 'github',
    githubRepo: document.getElementById('githubRepo').value.trim(),
    githubToken: document.getElementById('githubToken').value.trim(),
    githubBranch: document.getElementById('githubBranch').value.trim() || 'main',
    githubPath: 'assets'
  };
}
function loadPagesStatus(){
  const el=document.getElementById('pagesStatus');
  const repo=document.getElementById('githubRepo').value.trim();
  const token=document.getElementById('githubToken').value.trim();
  if(!repo||!token){el.textContent='填写仓库和 Token 后可查看/开启 GitHub Pages。';return;}
  el.textContent='查询中...';
  sendMessage({type:'GET_PAGES_STATUS', config:currentGithubConfig()}).then(resp=>{
    if(resp&&resp.success){
      if(resp.enabled){
        el.innerHTML=`已开启：<a href="${resp.url}" target="_blank" style="color:var(--accent);">${resp.url}</a>`+(resp.status?` <span style="color:var(--text-muted);">(状态：${resp.status})</span>`:'');
      }else{
        el.innerHTML='未开启。点击上方「开启 GitHub Pages」按钮即可开通。';
      }
    }else{
      el.innerHTML='<span style="color:var(--danger);">查询失败：</span>'+(resp?.error||'未知错误');
    }
  });
}
function enablePages(){
  const el=document.getElementById('pagesStatus');
  const repo=document.getElementById('githubRepo').value.trim();
  const token=document.getElementById('githubToken').value.trim();
  if(!repo||!token){showToast('请先填写 GitHub 仓库和 Token','error');return;}
  el.textContent='正在开启 GitHub Pages（首次部署约需 1-2 分钟）...';
  sendMessage({type:'ENABLE_PAGES', config:currentGithubConfig()}).then(resp=>{
    if(resp&&resp.success){
      el.innerHTML=`<span style="color:var(--success);">GitHub Pages 已开启</span>：<a href="${resp.url}" target="_blank" style="color:var(--accent);">${resp.url}</a>`+(resp.already?'<div style="margin-top:4px;">（此前已开启）</div>':'<div style="margin-top:4px;">首次访问请等待 1-2 分钟部署完成</div>');
      showToast('GitHub Pages 已开启','success');
    }else{
      el.innerHTML='<span style="color:var(--danger);">开启失败：</span>'+(resp?.error||'未知错误');
      showToast('开启失败：'+(resp?.error||'未知错误'),'error');
    }
  });
}
function syncIndexHtml(){
  const el=document.getElementById('pagesStatus');
  const repo=document.getElementById('githubRepo').value.trim();
  const token=document.getElementById('githubToken').value.trim();
  if(!repo||!token){showToast('请先填写 GitHub 仓库和 Token','error');return;}
  el.textContent='正在生成并上传 index.html...';
  sendMessage({type:'SYNC_INDEX_HTML', config:currentGithubConfig()}).then(resp=>{
    if(resp&&resp.success){
      el.innerHTML=`<span style="color:var(--success);">index.html 已生成/更新</span>（${resp.count||0} 张图片）<div style="margin-top:4px;">等待 GitHub Pages 部署（约 1 分钟）后即可访问。</div>`;
      showToast(`已更新 index.html（${resp.count||0} 张图片）`,'success');
    }else{
      el.innerHTML='<span style="color:var(--danger);">更新失败：</span>'+(resp?.error||'未知错误');
      showToast('更新失败：'+(resp?.error||'未知错误'),'error');
    }
  });
}
function saveSettings(){const mode=document.getElementById('storageMode').value;const config={cloudEnabled:mode!=='local',cloudProvider:mode,githubRepo:document.getElementById('githubRepo').value.trim(),githubToken:document.getElementById('githubToken').value.trim(),githubBranch:document.getElementById('githubBranch').value.trim()||'main',githubPath:'assets',apiUrl:document.getElementById('apiUrl').value.trim(),apiKey:document.getElementById('apiKey').value.trim(),showDragBtn:document.getElementById('cfgShowDragBtn').checked,autoAnalyze:true,defaultFolder:null,contextMenuEnabled:true};sendMessage({type:'SAVE_CONFIG',config}).then(()=>{showToast('设置已保存','success');closeModal('cloudModal');if(config.cloudProvider==='github'&&config.githubRepo&&config.githubToken){syncIndexHtml();}});}

// ===== 数据导入导出 =====
async function exportData(){showToast('正在准备备份（包含全部高清原图）...','info');const resp=await sendMessage({type:'EXPORT_DATA'});if(resp&&resp.success){const data={...resp.data,folders:state.folders};const blob=new Blob([JSON.stringify(data)],{type:'application/json'});const url=URL.createObjectURL(blob);const el=document.createElement('a');el.href=url;el.download=`素材库备份_${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(el);el.click();document.body.removeChild(el);URL.revokeObjectURL(url);showToast('备份文件已下载','success');}}
async function importData(event){const file=event.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=async function(e){try{const data=JSON.parse(e.target.result);if(!data.images&&!data.assets)throw new Error('无效');const images=data.images||data.assets||[];if(confirm(`即将导入 ${images.length} 张素材。确定继续吗？`)){const resp=await sendMessage({type:'IMPORT_JSON',images});if(resp&&resp.success){if(data.folders)state.folders=data.folders;saveFolders();await loadAllAssets();showToast(`成功导入 ${resp.imported} 张素材`,'success');}else{showToast('导入失败','error');}}}catch(err){showToast('导入失败：文件格式不正确','error');}};reader.readAsText(file);event.target.value='';}
async function clearAllData(){if(!confirm('确定清空所有数据吗？此操作不可恢复，建议先导出备份！'))return;await sendMessage({type:'CLEAR_ALL'});state.assets=[];state.selectedIds=[];state.activeAssetId=null;renderFolderTree();renderAssets();renderPanel();updateCounts();closeModal('cloudModal');switchView('all');showToast('所有数据已清空','success');}

// ===== 分享页面生成 =====
function openShareModal(){showModal('shareModal');}
function generateSharePage(){const scope=document.getElementById('shareScope').value;const title=document.getElementById('shareTitle').value||'我的素材库';const includeData=document.getElementById('shareIncludeData').checked;let assets=state.assets.filter(a=>!a.deleted);if(scope==='folder'&&state.currentFolderId)assets=assets.filter(a=>a.folderId===state.currentFolderId);if(scope==='favorites')assets=assets.filter(a=>a.favorite);if(!assets.length){showToast('没有可分享的素材','error');return;}const shareData=assets.map(a=>({id:a.id,name:a.name,url:includeData?getAssetSrc(a):(a.githubUrl||a.url||''),description:a.description||'',tags:a.tags||[],folderId:a.folderId,width:a.width,height:a.height,size:a.size,createdAt:a.createdAt,pageUrl:a.pageUrl}));const html=generateShareHTML(title,shareData,state.folders);const blob=new Blob([html],{type:'text/html'});const url=URL.createObjectURL(blob);const el=document.createElement('a');el.href=url;el.download=`${title}_${new Date().toISOString().slice(0,10)}.html`;document.body.appendChild(el);el.click();document.body.removeChild(el);URL.revokeObjectURL(url);showToast(`分享页面已生成（${assets.length} 张图片）`,'success');closeModal('shareModal');}
function generateShareHTML(title,assets,folders){const dataJson=JSON.stringify({assets,folders,title});return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escapeHtml(title)}</title><style>:root{--bg:#161616;--bg2:#1e1e1e;--bg3:#252525;--border:#333;--text:#e8e8e8;--text2:#a0a0a0;--muted:#6b6b6b;--accent:#f0a030;--accent-dim:rgba(240,160,48,.15);}*{margin:0;padding:0;box-sizing:border-box;}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);min-height:100vh;}.header{padding:20px 32px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:16px;position:sticky;top:0;background:var(--bg);z-index:100;backdrop-filter:blur(10px);}.header h1{font-size:20px;font-weight:600;color:var(--accent);}.header .count{font-size:13px;color:var(--muted);}.search{flex:1;max-width:400px;margin-left:auto;}.search input{width:100%;height:36px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:0 14px;color:var(--text);font-size:13px;outline:none;}.search input:focus{border-color:var(--accent);}.container{display:flex;min-height:calc(100vh - 73px);}.sidebar{width:200px;background:var(--bg2);border-right:1px solid var(--border);padding:16px 0;flex-shrink:0;}.folder-item{padding:8px 20px;cursor:pointer;color:var(--text2);font-size:13px;transition:all .12s;display:flex;align-items:center;gap:8px;}.folder-item:hover{background:var(--bg3);color:var(--text);}.folder-item.active{background:var(--accent-dim);color:var(--accent);}.folder-item svg{width:14px;height:14px;}.folder-item .cnt{margin-left:auto;font-size:11px;color:var(--muted);}.main{flex:1;padding:24px 32px;}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;}.card{background:var(--bg2);border:1px solid var(--border);border-radius:10px;overflow:hidden;cursor:pointer;transition:all .15s;}.card:hover{border-color:var(--accent);transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,0,0,.4);}.card .thumb{width:100%;aspect-ratio:1;background:var(--bg3);overflow:hidden;}.card .thumb img{width:100%;height:100%;object-fit:cover;transition:transform .3s;}.card:hover .thumb img{transform:scale(1.05);}.card .info{padding:10px 12px;}.card .name{font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.card .meta{font-size:10px;color:var(--muted);margin-top:3px;}.tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;}.tag{padding:1px 7px;background:var(--bg3);border-radius:8px;font-size:10px;color:var(--text2);}.lightbox{position:fixed;inset:0;background:rgba(0,0,0,.95);display:none;align-items:center;justify-content:center;z-index:1000;}.lightbox.show{display:flex;}.lightbox img{max-width:90vw;max-height:85vh;object-fit:contain;cursor:grab;}.lightbox .close{position:absolute;top:20px;right:20px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.1);border:none;color:white;cursor:pointer;font-size:20px;}.lightbox .info{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(30,30,30,.9);padding:8px 20px;border-radius:8px;font-size:12px;color:var(--text2);}.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:60vh;color:var(--muted);gap:12px;}.empty svg{width:64px;height:64px;opacity:.3;}@media(max-width:768px){.sidebar{display:none;}.header{padding:12px 16px;}.main{padding:16px;}.grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;}}</style></head><body><div class="header"><h1>${escapeHtml(title)}</h1><span class="count" id="totalCount"></span><div class="search"><input type="text" id="searchInput" placeholder="搜索素材..."></div></div><div class="container"><div class="sidebar" id="folderList"></div><div class="main"><div class="grid" id="grid"></div><div class="empty" id="empty" style="display:none;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg><p>没有找到匹配的素材</p></div></div></div><div class="lightbox" id="lightbox"><button class="close" onclick="closeLb()">&times;</button><img id="lbImg" src=""><div class="info" id="lbInfo"></div></div><script>const DATA=${dataJson};let currentFolder='all';let searchQuery='';function init(){document.getElementById('totalCount').textContent=DATA.assets.length+' 张图片';renderFolders();renderGrid();document.getElementById('searchInput').addEventListener('input',e=>{searchQuery=e.target.value;renderGrid();});document.getElementById('lightbox').addEventListener('click',e=>{if(e.target.id==='lightbox')closeLb();});}function renderFolders(){const list=document.getElementById('folderList');let html='<div class="folder-item '+(currentFolder==='all'?'active':'')+'" onclick="selectFolder(\'all\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>全部<span class="cnt">'+DATA.assets.length+'</span></div>';DATA.folders.forEach(f=>{const cnt=DATA.assets.filter(a=>a.folderId===f.id).length;html+='<div class="folder-item '+(currentFolder===f.id?'active':'')+'" onclick="selectFolder(\''+f.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'+esc(f.name)+'<span class="cnt">'+cnt+'</span></div>';});list.innerHTML=html;}function selectFolder(id){currentFolder=id;renderFolders();renderGrid();}function renderGrid(){let assets=DATA.assets;if(currentFolder!=='all')assets=assets.filter(a=>a.folderId===currentFolder);if(searchQuery){const q=searchQuery.toLowerCase();assets=assets.filter(a=>a.name.toLowerCase().includes(q)||(a.tags||[]).some(t=>t.toLowerCase().includes(q)));}const grid=document.getElementById('grid');const empty=document.getElementById('empty');if(!assets.length){grid.style.display='none';empty.style.display='flex';return;}grid.style.display='grid';empty.style.display='none';grid.innerHTML=assets.map(a=>'<div class="card" onclick="openLb(\''+a.id+'\')"><div class="thumb"><img src="'+a.url+'" alt="'+esc(a.name)+'" loading="lazy"></div><div class="info"><div class="name">'+esc(a.name)+'</div><div class="meta">'+(a.width?a.width+'×'+a.height+' · ':'')+fmtSize(a.size)+'</div>'+(a.tags&&a.tags.length?'<div class="tags">'+a.tags.slice(0,3).map(t=>'<span class="tag">'+esc(t)+'</span>').join('')+'</div>':'')+'</div></div>').join('');}function openLb(id){const a=DATA.assets.find(x=>x.id===id);if(!a)return;document.getElementById('lbImg').src=a.url;document.getElementById('lbInfo').textContent=a.name+(a.width?' · '+a.width+'×'+a.height:'')+(a.pageUrl?' · 来源: '+a.pageUrl:'');document.getElementById('lightbox').classList.add('show');}function closeLb(){document.getElementById('lightbox').classList.remove('show');}function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML;}function fmtSize(b){if(!b)return'';if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(1)+' KB';return(b/1048576).toFixed(1)+' MB';}document.addEventListener('keydown',e=>{if(e.key==='Escape')closeLb();});init();<\/script></body></html>`;}

// ===== 全局剪贴板 =====
function initClipboard(){
  document.addEventListener('paste',e=>{
    const tag=document.activeElement.tagName;
    if(tag==='INPUT'||tag==='TEXTAREA')return;
    const items=e.clipboardData.items;
    let found=false;
    for(let i=0;i<items.length;i++){
      const item=items[i];
      if(item.type.startsWith('image/')){
        found=true;
        const file=item.getAsFile();
        if(file)importImageFile(file);
      }
    }
    if(!found){
      const text=e.clipboardData.getData('text');
      if(text){
        const urls=parseUrls(text);
        if(urls.length>0){
          e.preventDefault();
          const fid=state.currentView==='folder'?state.currentFolderId:null;
          urls.forEach((url,idx)=>{
            setTimeout(async()=>{
              await sendMessage({type:'SAVE_IMAGE',imageUrl:url,pageUrl:'剪贴板',tags:[],folderId:fid});
              if(idx===urls.length-1){
                await loadAllAssets();
                showToast('已导入 '+urls.length+' 张图片','success');
              }
            },idx*300);
          });
        }
      }
    }
  });
}

// ===== 工具函数 =====
function escapeHtml(str){if(!str)return'';const d=document.createElement('div');d.textContent=str;return d.innerHTML;}
function formatFileSize(bytes){if(!bytes||bytes===0)return '未知';if(bytes<1024)return bytes+' B';if(bytes<1048576)return(bytes/1024).toFixed(1)+' KB';return(bytes/1048576).toFixed(1)+' MB';}
function formatDate(ts){const d=new Date(ts);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
function showToast(message,type='info'){const c=document.getElementById('toastContainer');const t=document.createElement('div');t.className=`toast ${type}`;t.textContent=message;c.appendChild(t);setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(20px)';t.style.transition='all .25s';setTimeout(()=>t.remove(),250);},2500);}
function updateCounts(){document.getElementById('countAll').textContent=state.assets.filter(a=>!a.deleted).length;document.getElementById('countFav').textContent=state.assets.filter(a=>!a.deleted&&a.favorite).length;document.getElementById('countTrash').textContent=state.assets.filter(a=>a.deleted).length;}
function showModal(id){document.getElementById(id).classList.add('show');}
function closeModal(id){document.getElementById(id).classList.remove('show');}

// ===== 键盘快捷键 =====
document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.getElementById('lightbox').classList.remove('show');document.querySelectorAll('.modal-overlay.show').forEach(m=>m.classList.remove('show'));if(state.vsResults){state.vsResults=null;renderAssets();}}if(e.ctrlKey&&e.key==='a'){const tag=document.activeElement.tagName;if(tag!=='INPUT'&&tag!=='TEXTAREA'){e.preventDefault();const assets=getFilteredAssets();state.selectedIds=assets.map(a=>a.id);state.activeAssetId=state.selectedIds[0]||null;renderAssets();renderPanel();updateSelectionBar();}}if(e.key==='Delete'&&state.selectedIds.length>0){const tag=document.activeElement.tagName;if(tag!=='INPUT'&&tag!=='TEXTAREA'){e.preventDefault();batchDelete();}}if(document.getElementById('lightbox').classList.contains('show')){if(e.key==='+'||e.key==='='){e.preventDefault();zoomLightbox(1.25);}if(e.key==='-'){e.preventDefault();zoomLightbox(0.8);}if(e.key==='0'){e.preventDefault();resetLightboxZoom();}}});

// ===== 主区域拖拽上传 =====
function initMainDragDrop(){const gc=document.getElementById('gridContainer');['dragenter','dragover'].forEach(evt=>gc.addEventListener(evt,e=>{e.preventDefault();e.stopPropagation();gc.style.background='var(--accent-dim)';}));['dragleave','drop'].forEach(evt=>gc.addEventListener(evt,e=>{e.preventDefault();e.stopPropagation();gc.style.background='';}));gc.addEventListener('drop',e=>{const files=e.dataTransfer.files;if(files.length>0)Array.from(files).forEach(f=>{if(f.type.startsWith('image/'))importImageFile(f);});});}
// ===== 素材卡片点击：单选 / 多选切换（原生事件，不依赖 CSP 内联解析） =====
function initAssetClick(){
  const grid=document.getElementById('assetGrid');
  grid.addEventListener('click',e=>{
    // 点击复选框：切换多选（阻止冒泡，避免触发卡片单选）
    const cb=e.target.closest('.asset-checkbox');
    if(cb){
      e.stopPropagation();
      const card=cb.closest('.asset-card');
      if(card)toggleSelect(card.dataset.id);
      return;
    }
    // 点击卡片本身：单选或按 modifier 多选
    const card=e.target.closest('.asset-card');
    if(card)selectAsset(card.dataset.id,e);
  });
}
// ===== 素材卡片拖拽到左侧文件夹 =====
function initAssetDragDrop(){
  const grid=document.getElementById('assetGrid');
  grid.addEventListener('dragstart',e=>{
    const card=e.target.closest('.asset-card');
    if(!card)return;
    const id=card.dataset.id;
    // 若该卡片在多选集合中且多于1项，则拖动全部选中项
    const ids=state.selectedIds.includes(id)&&state.selectedIds.length>1?state.selectedIds:[id];
    try{e.dataTransfer.setData('text/asset-ids',JSON.stringify(ids));}catch(err){}
    e.dataTransfer.effectAllowed='move';
    // 被拖动的所有卡片都半透明提示
    document.querySelectorAll('.asset-card').forEach(c=>{
      if(ids.includes(c.dataset.id))c.classList.add('dragging');
    });
  });
  grid.addEventListener('dragend',()=>{
    document.querySelectorAll('.asset-card.dragging').forEach(el=>el.classList.remove('dragging'));
    document.querySelectorAll('.folder-node.drag-over').forEach(el=>el.classList.remove('drag-over'));
  });
  const ft=document.getElementById('folderTree');
  ft.addEventListener('dragover',e=>{
    const node=e.target.closest('.folder-node');
    if(!node)return;
    // 仅响应素材卡片拖拽，忽略系统文件拖拽
    if(!Array.from(e.dataTransfer.types).includes('text/asset-ids'))return;
    e.preventDefault();e.stopPropagation();
    e.dataTransfer.dropEffect='move';
    node.classList.add('drag-over');
  });
  ft.addEventListener('dragleave',e=>{
    const node=e.target.closest('.folder-node');
    if(!node)return;
    if(!node.contains(e.relatedTarget))node.classList.remove('drag-over');
  });
  ft.addEventListener('drop',async e=>{
    const node=e.target.closest('.folder-node');
    if(!node)return;
    e.preventDefault();e.stopPropagation();
    node.classList.remove('drag-over');
    const folderId=node.dataset.folderId;
    if(!folderId)return;
    const data=e.dataTransfer.getData('text/asset-ids');
    if(!data)return;
    try{
      const ids=JSON.parse(data);
      if(!ids||!ids.length)return;
      await moveAssetsToFolder(ids,folderId);
    }catch(err){showToast('移动失败','error');}
  });
}
async function moveAssetsToFolder(ids,folderId){
  await batchUpdateAssets(ids,{folderId});
  renderAssets();renderFolderTree();updateCounts();
  const fn=state.folders.find(f=>f.id===folderId);
  showToast(`已移动 ${ids.length} 张图片到「${fn?fn.name:'根目录'}」`,'success');
}

// ===== 鼠标框选多选 =====
function initMarqueeSelect(){
  const container=document.getElementById('gridContainer');
  let marquee=null,startX=0,startY=0,isSelecting=false,baseSelected=[];
  container.addEventListener('mousedown',e=>{
    if(e.button!==0)return;
    // 只在点击空白区域时开始框选（点击卡片由单击/双击处理）
    if(e.target.closest('.asset-card')||e.target.closest('.empty-state'))return;
    isSelecting=true;
    startX=e.clientX;startY=e.clientY;
    baseSelected=e.shiftKey?[...state.selectedIds]:[];
    if(!e.shiftKey){state.selectedIds=[];state.activeAssetId=null;}
    marquee=document.createElement('div');
    marquee.style.cssText='position:fixed;border:1px dashed #f0a030;background:rgba(240,160,48,0.18);pointer-events:none;z-index:9999;border-radius:4px;';
    document.body.appendChild(marquee);
    e.preventDefault();
  });
  document.addEventListener('mousemove',e=>{
    if(!isSelecting||!marquee)return;
    const x=Math.min(e.clientX,startX),y=Math.min(e.clientY,startY);
    const w=Math.abs(e.clientX-startX),h=Math.abs(e.clientY-startY);
    marquee.style.left=x+'px';marquee.style.top=y+'px';
    marquee.style.width=w+'px';marquee.style.height=h+'px';
    // 实时更新卡片选中状态（只改 CSS 类，不重绘网格）
    const cards=document.querySelectorAll('.asset-card');
    const next=[...baseSelected];
    cards.forEach(card=>{
      const r=card.getBoundingClientRect();
      const hit=!(r.right<x||r.left>x+w||r.bottom<y||r.top>y+h);
      const id=card.dataset.id;
      const inBase=baseSelected.includes(id);
      if(hit&&!inBase){if(!next.includes(id))next.push(id);card.classList.add('selected');}
      else if(!hit&&!inBase){const i=next.indexOf(id);if(i>-1)next.splice(i,1);card.classList.remove('selected');}
      else if(hit&&inBase){card.classList.add('selected');}
      else if(!hit&&inBase){card.classList.remove('selected');const i=next.indexOf(id);if(i>-1)next.splice(i,1);}
    });
    state.selectedIds=next;
    state.activeAssetId=next.length===1?next[0]:null;
    updateSelectionBar();
  });
  document.addEventListener('mouseup',()=>{
    if(!isSelecting)return;
    isSelecting=false;
    if(marquee){marquee.remove();marquee=null;}
    renderAssets();renderPanel();updateSelectionBar();
  });
}

// ===== 初始化 =====
(function init(){
  loadFolders();
  renderFolderTree();
  renderColorPalette();
  renderTagFilter();
  initLightboxEvents();
  initClipboard();
  initMainDragDrop();
  initAssetClick();
  initAssetDragDrop();
  initMarqueeSelect();
  document.getElementById('searchInput').addEventListener('input',e=>{state.searchQuery=e.target.value;renderAssets();});
  loadAllAssets();
  // 定时刷新（检测扩展程序新增的图片）
  setInterval(async ()=>{
    const resp = await sendMessage({type:'GET_STATS'});
    if(resp && resp.success && resp.count !== state.assets.length){
      await loadAllAssets();
    }
  }, 5000);
})();
