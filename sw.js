// 새 버전이 바로 반영되도록: 네트워크 먼저, 안 되면 저장본
const C='studyapp-v0.1.14';
const F=['./','index.html','app.css','app.js','manifest.json','font/PretendardVariable.woff2','img/v2_tall.jpg','img/v2_wide.jpg','img/icon-180.png','img/icon-192.png','img/icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(F)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request,{ignoreSearch:true})))});
