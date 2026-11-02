(() => {
  window.SAIYAN_SNAPSHOT_NOW='2026-10-28T13:20:08+08:00';
  try {
    if (!localStorage.getItem('infinite-canvas:theme_store')) {
      localStorage.setItem('infinite-canvas:theme_store', JSON.stringify({state:{theme:localStorage.getItem('saiyan_demo_theme')==='dark'?'dark':'light'},version:0}));
    }
    const theme=JSON.parse(localStorage.getItem('infinite-canvas:theme_store')).state?.theme==='dark'?'dark':'light';
    document.documentElement.dataset.theme=theme;
    document.documentElement.classList.toggle('dark',theme==='dark');
    document.documentElement.style.colorScheme=theme;
    localStorage.setItem('comfyart.lang','zh');
  } catch {}
  const sockets=new Set();
  const events=new BroadcastChannel('saiyan-browser-events');
  class LocalSocket extends EventTarget {
    static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
    constructor(url) {
      super();this.url=String(url);this.readyState=0;this.bufferedAmount=0;this.extensions='';this.protocol='';this.binaryType='blob';sockets.add(this);
      queueMicrotask(()=>{this.readyState=1;const e=new Event('open');this.dispatchEvent(e);this.onopen?.(e);});
    }
    send() {}
    close() {this.readyState=3;sockets.delete(this);}
  }
  events.onmessage=({data})=>{for(const s of sockets){if(s.readyState!==1)continue;const e=new MessageEvent('message',{data:JSON.stringify(data)});s.dispatchEvent(e);s.onmessage?.(e);}};
  window.WebSocket=LocalSocket;
  const nativeFetch=window.fetch.bind(window);
  window.fetch=(input,init)=>{
    const url=new URL(typeof input==='string'?input:input.url||String(input),location.href);
    if(url.protocol==='data:'||url.protocol==='blob:'||url.origin===location.origin)return nativeFetch(input,init);
    return Promise.resolve(url.pathname.endsWith('/VERSION')?new Response('0.19.0'):Response.json([]));
  };
  window.saiyanReady=(async()=>{
    if(!('serviceWorker' in navigator))throw new Error('请使用支持本地存储的现代浏览器打开。');
    const registration=await navigator.serviceWorker.register('/service-worker.js',{scope:'/',updateViaCache:'none'});
    await registration.update();
    const incoming=registration.installing||registration.waiting;
    if(incoming&&incoming.state!=='activated')await new Promise((resolve,reject)=>{
      incoming.addEventListener('statechange',()=>{
        if(incoming.state==='activated')resolve();
        if(incoming.state==='redundant')reject(new Error('页面更新未完成，请刷新重试。'));
      });
    });
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller) await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
    const project=new URL(location.href).searchParams.get('project');
    if(project&&location.pathname.startsWith('/comfyart')){
      const key='saiyan-navigation:v1:chat:'+project;
      if(localStorage.getItem(key)===null){
        const response=await nativeFetch('/api/comfyart/bot/chats?project='+encodeURIComponent(project));
        if(response.ok){const data=await response.json();if(data.chats?.[0])localStorage.setItem(key,data.chats[0].id);}
      }
    }
  })();
})();
