const elements = {
  hide: document.getElementById('btn-toggle-hide'),
  pick: document.getElementById('btn-toggle-pick'),
  undo: document.getElementById('btn-undo'),
  markdown: document.getElementById('btn-export-md'),
  pdf: document.getElementById('btn-export-pdf'),
  status: document.getElementById('status-msg'),
  statusDot: document.getElementById('status-dot')
};

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.statusDot.classList.toggle('is-error', isError);
}

async function sendToActiveTab(action) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('没有找到当前标签页');
  try {
    return await chrome.tabs.sendMessage(tab.id, { action });
  } catch (error) {
    throw new Error('当前页面不支持插件操作，请切换到普通网页后重试');
  }
}

function setActive(button, active) {
  button.classList.toggle('is-active', Boolean(active));
}

elements.hide.addEventListener('click', async () => {
  try {
    const result = await sendToActiveTab('TOGGLE_HIDE_MODE');
    setActive(elements.hide, result?.isHideMode);
    if (result?.isHideMode) setActive(elements.pick, false);
    setStatus(result?.isHideMode ? '隐藏模式已开启，点击页面元素即可隐藏' : '隐藏模式已关闭');
  } catch (error) { setStatus(error.message, true); }
});

elements.pick.addEventListener('click', async () => {
  try {
    const result = await sendToActiveTab('TOGGLE_PICK_MODE');
    setActive(elements.pick, result?.isPickMode);
    if (result?.isPickMode) setActive(elements.hide, false);
    setStatus(result?.isPickMode ? `框选模式已开启，可连续点击多个区域${result.selectedCount ? `（已选 ${result.selectedCount} 个）` : ''}` : '框选模式已关闭');
  } catch (error) { setStatus(error.message, true); }
});

elements.undo.addEventListener('click', async () => {
  try {
    const result = await sendToActiveTab('UNDO_HIDE');
    setStatus(result?.restored ? `已撤销，剩余隐藏项：${result.stackCount}` : '没有可撤销的隐藏元素');
  } catch (error) { setStatus(error.message, true); }
});

elements.markdown.addEventListener('click', async () => {
  try {
    const result = await sendToActiveTab('EXPORT_MARKDOWN');
    setStatus(result?.ok ? (result.selectedCount ? `已导出 ${result.selectedCount} 个区域，Markdown 文件已开始下载` : '页面内容已导出为 Markdown') : (result?.message || 'Markdown 导出失败'), !result?.ok);
  } catch (error) { setStatus(error.message, true); }
});

elements.pdf.addEventListener('click', async () => {
  try {
    const result = await sendToActiveTab('EXPORT_PDF');
    setStatus(result?.ok ? (result.selectedCount ? `已准备 ${result.selectedCount} 个区域，请在打印对话框中另存为 PDF` : '已打开打印对话框，可选择“另存为 PDF”') : (result?.message || 'PDF 导出失败'), !result?.ok);
  } catch (error) { setStatus(error.message, true); }
});
