import assert from 'node:assert/strict';
const base='http://127.0.0.1:3000';
for(const [path,payload,expected] of [
['/api/classify',{prompt:''},400],
['/api/classify',null,400],
['/api/logs/rank',{query:'errors',logs:'line\n'.repeat(2001)},400],
['/api/e2e/run',{task:'Do something',expectation:''},400],
]){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});assert.equal(r.status,expected);console.log('PASS',path,r.status);}
const cross=await fetch(base+'/api/classify',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:JSON.stringify({prompt:'hello'})});assert.equal(cross.status,403);console.log('PASS cross-origin request rejected');
const sample=await(await fetch(base+'/api/logs/sample')).json();const controller=new AbortController();const response=await fetch(base+'/api/logs/rank',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'Why is login failing?',logs:sample.logs}),signal:controller.signal});const reader=response.body.getReader();await reader.read();controller.abort();try{await reader.read();}catch(e){assert.equal(e.name,'AbortError');}reader.releaseLock();console.log('PASS streamed log request can be cancelled');

const pagesOrigin='https://infinitexyy.github.io';
const preflight=await fetch(base+'/api/classify',{method:'OPTIONS',headers:{Origin:pagesOrigin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type','Access-Control-Request-Private-Network':'true'}});
assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),pagesOrigin);assert.equal(preflight.headers.get('access-control-allow-private-network'),'true');
const allowed=await fetch(base+'/api/health',{headers:{Origin:pagesOrigin}});assert.equal(allowed.status,200);assert.equal(allowed.headers.get('access-control-allow-origin'),pagesOrigin);assert.equal((await allowed.json()).engine,'laya.Router');
const denied=await fetch(base+'/api/health',{headers:{Origin:'https://example.com'}});assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
console.log('PASS Pages CORS and private-network preflight; unrelated origins blocked');
