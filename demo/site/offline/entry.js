const path=document.querySelector('script[data-entry]').dataset.entry;
try { await window.saiyanReady; await import(path); }
catch(error) { const message=document.createElement('p');message.setAttribute('role','alert');message.style.cssText='padding:32px;font:15px sans-serif';message.textContent='页面暂时未能打开，请刷新重试。';document.body.append(message);console.error(error); }
