// Runs only against a temporary local D1 database. No production credentials or database are used.
import assert from 'node:assert/strict';
const {Miniflare,convertV4MiniflareOptions} = await import(process.env.MINIFLARE_MODULE || 'miniflare');
import {migrate,saveSettings} from '../src/db.js';
import {onRequest} from '../functions/[[path]].js';
import {signToken,randomId,now,getCookie,vnDay} from '../src/util.js';
import {ADMIN} from '../src/security.js';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("OK")}}',compatibilityDate:'2026-10-11',d1Databases:{DB:'security-validation'}}));
const db=await mf.getD1Database('DB'),origin='https://test.invalid',secret=randomId(40),us=randomId(40),tasks=[];
const scalar=async(sql,...args)=>Object.values(await db.prepare(sql).bind(...args).first())[0];
try {
 await migrate(db);await migrate(db);
 assert.equal(await scalar("SELECT COUNT(*) FROM sqlite_master WHERE name='wallet_log'"),1);
 assert.equal(getCookie(new Request(origin,{headers:{cookie:'aw_user=%'}}),'aw_user'),null);
 await saveSettings(db,{admin_user:'security-test',secret,user_secret:us,checkin_wait:'0',checkin_exp:'0',heart_exp:'0',rate_exp:'0',withdraw_min:'10',withdraw_daily:'1',reg_email_enabled:'0'});
 for(let id=1;id<=8;id++)await db.prepare('INSERT INTO users(id,sub,name,email,created_at,last_login,stones,seen_day,role,locked) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,'s'+id,'User '+id,'user'+id+'@example.test',now(),now(),1000,vnDay(),id===3?'editor':'',id===4?1:0).run();
 await db.prepare("INSERT INTO tracks(id,title,slug,published,created_at,updated_at) VALUES(1,'Truyện thử','story',1,?,?)").bind(now(),now()).run();
 await db.prepare("INSERT INTO tracks(id,title,slug,published,created_at,updated_at) VALUES(2,'Bản nháp','draft',0,?,?)").bind(now(),now()).run();
 const cookie=async(id,extra={})=>'aw_user='+encodeURIComponent(await signToken(us,{uid:id,v:0,exp:now()+3600,...extra}));
 const u2=await cookie(2),editor=await cookie(3),locked=await cookie(4),demo=await cookie(2,{demo:1});
 const admin='aw_admin='+encodeURIComponent(await signToken(secret,{u:'security-test',exp:now()+3600}));
 async function call(path,{method='POST',body={},auth=u2,headers={},stream=false,allow500=false}={}) {
  const data=typeof body==='string'?body:JSON.stringify(body);
  const req=new Request(origin+path,{method,headers:{'Content-Type':'application/json',Origin:origin,'CF-Connecting-IP':'192.0.2.1',...(auth?{Cookie:auth}:{}),...headers},...(method==='GET'?{}:{body:stream?new ReadableStream({start(c){for(let i=0;i<data.length;i+=4000)c.enqueue(new TextEncoder().encode(data.slice(i,i+4000)));c.close();}}):data,...(stream?{duplex:'half'}:{})})});
  const res=await onRequest({request:req,env:{DB:db},waitUntil:p=>tasks.push(p.catch(()=>{}))});let out=await res.text();try{out=JSON.parse(out);}catch{}
  if(!allow500)assert.notEqual(res.status,500,'No 500: '+path);return {status:res.status,data:out,headers:res.headers};
 }
 assert.equal((await call('/api/profile',{body:'null'})).status,400);
 for(const body of ['[]','"hello"','123'])assert.equal((await call('/api/profile',{body})).status,400);
 for(const stream of [false,true])assert.equal((await call('/api/profile',{body:{name:'x'.repeat(70000)},stream})).status,413);
 assert.equal((await call('/api/profile',{body:{name:'x'.repeat(70000)},headers:{'Content-Length':'1'}})).status,413);
 assert.equal((await call('/api/profile/avatar',{body:'x'.repeat(3*1024*1024+1),stream:true})).status,413);
 for(const auth of ['',u2+'.forged',await cookie(2,{exp:now()-1}),locked,await cookie(2,{v:99})])assert.equal((await call('/api/history',{method:'GET',auth})).status,401,'session protected');
 assert.equal((await call('/api/me',{method:'GET',auth:'aw_user=%'})).data.me,null);
 assert.equal((await call('/api/profile',{body:{name:'Tên mới'},headers:{Origin:'https://other.invalid'}})).status,400);
 for(const path of ['/api/checkin','/api/quest/open','/api/shop/buy','/api/withdraw','/api/comments'])assert.equal((await call(path,{auth:demo})).status,403,'demo read only');
 assert.equal((await call(ADMIN+'/overview',{method:'GET',auth:''})).status,303);
 assert.equal((await call('/bien-tap',{method:'GET',auth:u2})).status,404);
 assert.equal((await call('/bien-tap',{method:'GET',auth:editor})).status,200);
 assert.equal((await call('/bien-tap/settings',{method:'GET',auth:editor})).status,303);
 assert.equal((await call(ADMIN+'/settings',{auth:admin,headers:{Origin:'https://other.invalid'}})).status,400);
 assert.equal((await call('/api/comments/delete',{body:{id:1}})).status,403);
 assert.equal((await call('/track/draft',{method:'GET'})).status,404);
 assert.equal((await call('/api/rate',{body:{track_id:1,stars:11}})).status,400);
 assert.equal((await call('/api/rate',{auth:await cookie(8),body:{track_id:2,stars:10}})).status,404);
 assert.equal((await call('/api/history',{body:{track_id:1,pos:'Infinity',dur:60}})).status,400);
 const injected=await call('/api/suggest?q='+encodeURIComponent("' OR 1=1 --"),{method:'GET'});assert.equal(injected.status,200);assert.equal(injected.data.items.length,0);assert.equal(await scalar('SELECT COUNT(*) FROM tracks'),2);
 const rates=await Promise.all(Array.from({length:4},()=>call('/api/rate',{body:{track_id:1,stars:8}})));assert.equal(rates.filter(r=>r.data.ok).length,1);assert.equal(await scalar('SELECT rating_count FROM tracks WHERE id=1'),1);assert.equal(await scalar('SELECT stones FROM users WHERE id=2'),1010);
 await Promise.all(Array.from({length:4},()=>call('/api/heart',{body:{track_id:1}})));assert.equal(await scalar('SELECT COUNT(*) FROM track_hearts WHERE user_id=2'),1);assert.equal(await scalar('SELECT stones FROM users WHERE id=2'),1011);
 const ck=await Promise.all(Array.from({length:4},()=>call('/api/checkin')));assert.equal(ck.filter(r=>r.data.ok).length,1);assert.equal(await scalar('SELECT stones FROM users WHERE id=2'),1021);
 await db.prepare("INSERT INTO quests(id,title,url,stones,exp,active,created_at) VALUES(99,'Thử','https://example.test',7,0,1,?)").bind(now()).run();
 const qr=await Promise.all(Array.from({length:4},()=>call('/api/quest/open',{body:{id:99}})));assert.equal(qr.filter(r=>r.data.rewards?.length).length,1);assert.equal(await scalar('SELECT stones FROM users WHERE id=2'),1028);
 const u5=await cookie(5);await Promise.all(Array.from({length:4},()=>call('/api/quest/listen',{auth:u5,body:{sec:999999}})));assert((await scalar('SELECT listen_sec FROM users WHERE id=5'))<=121,'real elapsed cap');
 await db.prepare("INSERT INTO shop_items(id,name,kind,fx,price,days,active,created_at) VALUES(99,'Permanent','fx','kim',100,0,1,?)").bind(now()).run();
 const purchases=await Promise.all(Array.from({length:4},()=>call('/api/shop/buy',{body:{id:99}})));assert.equal(purchases.filter(r=>r.data.ok).length,1);assert.equal(await scalar('SELECT stones FROM users WHERE id=2'),928);assert.equal(await scalar('SELECT sold FROM shop_items WHERE id=99'),1);
 assert.equal((await call('/api/shop/use',{auth:u5,body:{fx:'kim'}})).status,400);
 await db.prepare("INSERT INTO shop_items(id,name,kind,fx,price,days,active,created_at) VALUES(100,'VIP test','vip','',600,7,1,?)").bind(now()).run();
 const u6=await cookie(6);const vp=await Promise.all(Array.from({length:2},()=>call('/api/shop/buy',{auth:u6,body:{id:100}})));assert.equal(vp.filter(r=>r.data.ok).length,1);assert.equal(await scalar('SELECT stones FROM users WHERE id=6'),400);assert((await scalar('SELECT vip_until FROM users WHERE id=6'))>now());
 await db.prepare("INSERT INTO payout_accounts(id,user_id,method,bank,number,holder,created_at) VALUES(1,2,'momo','','0900000000','NGUYEN VAN A',?)").bind(now()).run();
 await db.prepare("INSERT INTO payout_accounts(id,user_id,method,bank,number,holder,created_at) VALUES(2,5,'momo','','0900000001','NGUYEN VAN B',?)").bind(now()).run();
 assert.equal((await call('/api/withdraw',{body:{account_id:2,amount:100}})).status,400,'cannot withdraw to other account');
 await call('/api/withdraw/account/delete',{body:{id:2}});assert.equal(await scalar('SELECT COUNT(*) FROM payout_accounts WHERE id=2'),1,'ownership');
 const wd=await Promise.all(Array.from({length:2},()=>call('/api/withdraw',{body:{account_id:1,amount:100}})));assert.equal(wd.filter(r=>r.data.ok).length,1);assert.equal(await scalar("SELECT COUNT(*) FROM withdrawals WHERE user_id=2 AND status='pending'"),1);assert.equal(await scalar('SELECT stones FROM users WHERE id=2'),828);
 assert.equal(await scalar('SELECT COUNT(*) FROM users WHERE stones < 0'),0);
 const form=new FormData();form.append('avatar',new Blob([Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])],{type:'image/png'}),'avatar.png');
 const av=await onRequest({request:new Request(origin+'/api/profile/avatar',{method:'POST',headers:{Cookie:u2,Origin:origin,'CF-Connecting-IP':'192.0.2.1'},body:form}),env:{DB:db},waitUntil:p=>tasks.push(p.catch(()=>{}))});assert.equal(av.status,200,'normal multipart still works');assert((await av.json()).avatar.startsWith('/media/'));
 await Promise.all(tasks);

 // Additional regression coverage for the confirmed findings and new private ledger.
 const {handleShopApi}=await import('../src/shop.js');
 const {awardExp}=await import('../src/game.js');
 const {walletAnomalies}=await import('../src/wallet.js');
 const {loadSettings}=await import('../src/db.js');
 const {hashPassword}=await import('../src/util.js');
 for(let id=20;id<=36;id++) await db.prepare('INSERT INTO users(id,sub,name,email,created_at,last_login,stones,seen_day,seen_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,'audit'+id,'Audit '+id,'audit'+id+'@example.test',now(),now(),100,vnDay(),now()).run();
 await db.prepare('UPDATE users SET stones=10 WHERE id=20').run();
 await db.prepare("INSERT INTO shop_items(id,name,kind,fx,price,days,active,created_at) VALUES(201,'Audit permanent','fx','lua',50,0,1,?)").bind(now()).run();
 const s=await loadSettings(db),me20=await db.prepare('SELECT * FROM users WHERE id=20').first();let interleaved=false;
 const wrapped={batch:stmts=>db.batch(stmts.map(st=>st.raw)),prepare(sql){const st=db.prepare(sql);return {bind(...args){const b=st.bind(...args);return {raw:b,first:(...a)=>b.first(...a),all:(...a)=>b.all(...a),async run(){const r=await b.run();if(sql.includes('INSERT INTO user_fx')&&r.meta.changes){interleaved=true;await handleShopApi(new Request(origin+'/api/shop/use',{method:'POST'}),db,s,'/api/shop/use',me20,{fx:'lua'});}return r;}};}};}};
 const poor=await handleShopApi(new Request(origin+'/api/shop/buy',{method:'POST'}),wrapped,s,'/api/shop/buy',me20,{id:201});assert.equal(poor.status,400);assert.equal(interleaved,false,'no temporary unpaid ownership');assert.equal(await scalar('SELECT name_fx FROM users WHERE id=20'),'');assert.equal(await scalar('SELECT COUNT(*) FROM user_fx WHERE user_id=20'),0);
 const originalConsoleError=console.error;console.error=()=>{};
 try{
  await db.prepare("CREATE TRIGGER fail_sold BEFORE UPDATE OF sold ON shop_items WHEN NEW.id=201 BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  assert.equal((await call('/api/shop/buy',{auth:await cookie(25),body:{id:201},allow500:true})).status,500);
  assert.equal(await scalar('SELECT stones FROM users WHERE id=25'),100);assert.equal(await scalar('SELECT COUNT(*) FROM user_fx WHERE user_id=25'),0);assert.equal(await scalar('SELECT COUNT(*) FROM wallet_log WHERE user_id=25'),0);assert.equal(await scalar('SELECT sold FROM shop_items WHERE id=201'),0);
  await db.prepare('DROP TRIGGER fail_sold').run();
  assert.equal((await call('/api/shop/buy',{auth:await cookie(25),body:{id:201}})).data.ok,true);assert.equal(await scalar('SELECT stones FROM users WHERE id=25'),50);
  await db.prepare("INSERT INTO shop_items(id,name,kind,fx,price,days,active,created_at) VALUES(202,'Audit VIP','vip','',10,7,1,?)").bind(now()).run();
  await db.prepare("CREATE TRIGGER fail_vip BEFORE UPDATE OF sold ON shop_items WHEN NEW.id=202 BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  assert.equal((await call('/api/shop/buy',{auth:await cookie(25),body:{id:202},allow500:true})).status,500);assert.equal(await scalar('SELECT stones FROM users WHERE id=25'),50);assert.equal(await scalar('SELECT vip_until FROM users WHERE id=25'),0);
  await db.prepare('DROP TRIGGER fail_vip').run();assert.equal((await call('/api/shop/buy',{auth:await cookie(25),body:{id:202}})).data.ok,true);assert.equal(await scalar('SELECT stones FROM users WHERE id=25'),40);
  await db.prepare("INSERT INTO payout_accounts(id,user_id,method,number,holder,created_at) VALUES(25,25,'momo','0900000025','AUDIT USER',?)").bind(now()).run();
  await db.prepare("CREATE TRIGGER fail_wd BEFORE INSERT ON wallet_log WHEN NEW.user_id=25 AND NEW.note LIKE 'Rút%' BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  assert.equal((await call('/api/withdraw',{auth:await cookie(25),body:{account_id:25,amount:10},allow500:true})).status,500);assert.equal(await scalar('SELECT stones FROM users WHERE id=25'),40);assert.equal(await scalar('SELECT COUNT(*) FROM withdrawals WHERE user_id=25'),0);
  await db.prepare('DROP TRIGGER fail_wd').run();assert.equal((await call('/api/withdraw',{auth:await cookie(25),body:{account_id:25,amount:10}})).data.ok,true);assert.equal(await scalar('SELECT stones FROM users WHERE id=25'),30);
  const wid=await scalar('SELECT id FROM withdrawals WHERE user_id=25');
  async function adminProcess(action){const form=new FormData();form.append('action',action);form.append('id',wid);return onRequest({request:new Request(origin+ADMIN+'/withdrawals',{method:'POST',headers:{Cookie:admin,Origin:origin,'CF-Connecting-IP':'192.0.2.1'},body:form}),env:{DB:db},waitUntil:p=>tasks.push(p.catch(()=>{}))});}
  await db.prepare("CREATE TRIGGER fail_refund BEFORE INSERT ON member_log WHEN NEW.user_id=25 AND NEW.action='withdraw_refund' BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  assert.equal((await adminProcess('reject')).status,500);assert.equal(await scalar('SELECT stones FROM users WHERE id=25'),30);assert.equal(await scalar('SELECT status FROM withdrawals WHERE id=?',wid),'pending');
  await db.prepare('DROP TRIGGER fail_refund').run();const rejects=await Promise.all([adminProcess('reject'),adminProcess('reject')]);assert(rejects.every(r=>r.status===303));assert.equal(await scalar('SELECT stones FROM users WHERE id=25'),40);assert.equal(await scalar("SELECT COUNT(*) FROM member_log WHERE user_id=25 AND action='withdraw_refund'"),1);assert.equal(await scalar("SELECT COUNT(*) FROM wallet_log WHERE user_id=25 AND note LIKE 'Hoàn%'"),1);
 }finally{console.error=originalConsoleError;}
 await db.prepare('UPDATE users SET exp=95,stones=0 WHERE id=21').run();const results=await Promise.all(Array.from({length:6},()=>awardExp(db,s,21,2,'Audit earned EXP')));assert.equal(await scalar('SELECT exp FROM users WHERE id=21'),107);assert.equal(await scalar('SELECT stones FROM users WHERE id=21'),200);assert.equal(results.flat().filter(r=>r.type==='levelup').length,1);assert.equal(await scalar("SELECT COUNT(*) FROM wallet_log WHERE user_id=21 AND note LIKE 'Thưởng đột phá%'"),1);
 const expRows=await db.prepare("SELECT balance FROM wallet_log WHERE user_id=21 AND kind='exp' ORDER BY id").all();assert.deepEqual(expRows.results.map(r=>r.balance),[97,99,101,103,105,107]);
 await db.prepare("CREATE TRIGGER fail_exp BEFORE INSERT ON wallet_log WHEN NEW.user_id=21 AND NEW.kind='exp' BEGIN SELECT RAISE(ABORT,'test failure'); END").run();await assert.rejects(awardExp(db,s,21,2,'Audit earned EXP'));assert.equal(await scalar('SELECT exp FROM users WHERE id=21'),107);await db.prepare('DROP TRIGGER fail_exp').run();
 const freshAuth=await cookie(22);await call('/api/online',{auth:freshAuth,body:{sec:999999}});await call('/api/quest/listen',{auth:freshAuth,body:{sec:999999}});assert((await scalar('SELECT online_sec FROM users WHERE id=22'))<=1,'no first-request free online time');assert((await scalar('SELECT listen_sec FROM users WHERE id=22'))<=1,'no first-request free listen time');
 await db.prepare('UPDATE users SET listen_day=?,listen_at=?,listen_sec=0 WHERE id=22').bind(vnDay(),now()-35).run();await Promise.all([call('/api/quest/listen',{auth:freshAuth,body:{sec:999999}}),call('/api/quest/listen',{auth:freshAuth,body:{sec:999999}})]);assert((await scalar('SELECT listen_sec FROM users WHERE id=22'))<=36,'parallel time reports respect real clock');
 assert.equal((await call('/api/rate',{auth:await cookie(23),body:{track_id:1,stars:8.5}})).status,400);
 await saveSettings(db,{rate_daily:'0',heart_daily:'0'});assert.equal((await call('/api/rate',{auth:await cookie(23),body:{track_id:1,stars:8}})).status,429);assert.equal((await call('/api/heart',{auth:await cookie(23),body:{track_id:1}})).status,429);await saveSettings(db,{rate_daily:'15',heart_daily:'50'});
 for(const amount of [-10,0,'Infinity','NaN','9007199254740993'])assert.equal((await call('/api/withdraw',{auth:await cookie(24),body:{amount}})).status,400);
 const ledger=await call('/api/wallet?user_id=25',{method:'GET'});assert.equal(ledger.status,200);assert.equal(ledger.headers.get('Cache-Control'),'no-store');assert(ledger.data.items.length);for(const item of ledger.data.items)assert.equal(await scalar('SELECT user_id FROM wallet_log WHERE id=?',item.id),2,'user-id tampering ignored');assert(!JSON.stringify(ledger.data).includes('user25@example'));
 assert.equal((await call('/api/wallet',{method:'GET',auth:''})).status,401);assert.equal((await call('/api/wallet')).status,405);assert.equal((await call('/api/wallet?before=Infinity&kind=invalid',{method:'GET'})).status,200);
 await db.prepare("INSERT INTO comments(track_id,user_id,body,status,created_at) VALUES(2,2,'Private draft comment','approved',?)").bind(now()).run();const privateComments=await call('/api/comments?track=2',{method:'GET',auth:''});assert.equal(privateComments.data.items.length,0);
 await db.prepare('UPDATE users SET stones=-1 WHERE id=28').run();await db.prepare('UPDATE users SET exp=50 WHERE id=29').run();await db.prepare("INSERT INTO wallet_log(user_id,kind,amount,balance,note,created_at) VALUES(29,'exp',10,10,'Audit historical',?)").bind(now()-500).run();
 await db.prepare('UPDATE users SET stones=20 WHERE id=30').run();for(let i=1;i<=2;i++)await db.prepare("INSERT INTO wallet_log(user_id,kind,amount,balance,note,created_at) VALUES(30,'stones',10,?,'Điểm danh hằng ngày',?)").bind(i*10,now()-500).run();
 await db.prepare("INSERT INTO wallet_log(user_id,kind,amount,balance,note,created_at) VALUES(31,'exp',1000000,1000000,'Đánh giá truyện',?)").bind(now()).run();await db.prepare('UPDATE users SET exp=1000000 WHERE id=31').run();
 for(const note of ['Admin cộng','Hoa hồng giới thiệu','Hoàn lại do yêu cầu rút bị từ chối','Thưởng đột phá'])await db.prepare("INSERT INTO wallet_log(user_id,kind,amount,balance,note,created_at) VALUES(32,'stones',1000000,1000000,?,?)").bind(note,now()).run();
 const anomalies=await walletAnomalies(db,await loadSettings(db));for(const id of [28,29,30,31])assert(anomalies.rows.some(r=>r.id===id),'flag anomaly '+id);assert(!anomalies.rows.some(r=>r.id===32),'admin/referral/refund/level excluded');
 assert.equal((await call(ADMIN+'/wallet-audit',{method:'GET',auth:''})).status,303);assert.equal((await call('/bien-tap/wallet-audit',{method:'GET',auth:editor})).status,303);const adminAudit=await call(ADMIN+'/wallet-audit',{method:'GET',auth:admin});assert.equal(adminAudit.status,200);assert(adminAudit.data.includes('Audit 28'));assert.equal(adminAudit.headers.get('Cache-Control'),'no-store');assert(adminAudit.headers.get('Content-Security-Policy').includes("script-src 'self'"));
 // Database-side IP limits hold even when several registration requests pass the initial checks together.
 await saveSettings(db,{email_auth:'1',reg_per_ip:'2',reg_block_proxy:'0'});
 const registrations=await Promise.all(Array.from({length:4},(_,i)=>call('/api/auth/register',{auth:'',headers:{'CF-Connecting-IP':'192.0.2.98'},body:{email:'new-audit-'+i+'@example.test',password:'Audit-password-123',password2:'Audit-password-123'}})));
 assert.equal(registrations.filter(r=>r.data.ok).length,2);assert.equal(await scalar("SELECT COUNT(*) FROM users WHERE reg_ip='192.0.2.98'"),2);
 // Google linking must invalidate an unverified email claimant, but retain verified password login.
 const kp=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',kp.publicKey);jwk.kid='audit-key';
 const b64url=x=>Buffer.from(x).toString('base64url');async function googleCredential(sub,email,emailVerified){const head=b64url(JSON.stringify({alg:'RS256',kid:jwk.kid})),payload=b64url(JSON.stringify({iss:'https://accounts.google.com',aud:'audit-client',sub,email,email_verified:emailVerified,exp:now()+600,name:'Email owner'}));const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',kp.privateKey,new TextEncoder().encode(head+'.'+payload));return head+'.'+payload+'.'+b64url(new Uint8Array(sig));}
 await saveSettings(db,{google_client_id:'audit-client'});const passwordHash=await hashPassword('Audit-password-123');for(const id of [35,36])await db.prepare('UPDATE users SET sub=?,pass_hash=?,email_verified=? WHERE id=?').bind('email:audit'+id+'@example.test',passwordHash,id===36?1:0,id).run();
 const originalFetch=globalThis.fetch;globalThis.fetch=(input,...args)=>String(input)==='https://www.googleapis.com/oauth2/v3/certs'?Promise.resolve(new Response(JSON.stringify({keys:[jwk]}),{headers:{'Content-Type':'application/json'}})):originalFetch(input,...args);
 try{
  assert.equal((await call('/api/auth/google',{auth:'',body:{credential:await googleCredential('google35','audit35@example.test',false)}})).status,401);assert.equal(await scalar('SELECT email_verified FROM users WHERE id=35'),0);
  const merged=await call('/api/auth/google',{auth:'',body:{credential:await googleCredential('google35','audit35@example.test',true)}});assert.equal(merged.status,200);assert.equal(await scalar('SELECT pass_hash FROM users WHERE id=35'),'');assert.equal(await scalar('SELECT session_ver FROM users WHERE id=35'),1);assert.equal((await call('/api/me',{method:'GET',auth:await cookie(35)})).data.me,null);
  assert.equal((await call('/api/auth/google',{auth:'',body:{credential:await googleCredential('google36','audit36@example.test',true)}})).status,200);assert.equal(await scalar('SELECT pass_hash FROM users WHERE id=36'),passwordHash);
  const googleRegistrations=await Promise.all(Array.from({length:4},async(_,i)=>call('/api/auth/google',{auth:'',headers:{'CF-Connecting-IP':'192.0.2.99'},body:{credential:await googleCredential('new-google-'+i,'new-google-'+i+'@example.test',true)}})));
  assert.equal(googleRegistrations.filter(r=>r.data.ok).length,2);assert.equal(await scalar("SELECT COUNT(*) FROM users WHERE reg_ip='192.0.2.99'"),2);
 }finally{globalThis.fetch=originalFetch;}
 // Anomaly pagination is complete and private server configuration never enters public responses.
 for(let firstId=400;firstId<=504;firstId+=50){const ids=Array.from({length:Math.min(50,505-firstId)},(_,i)=>firstId+i);await db.batch(ids.map(id=>db.prepare("INSERT INTO users(id,sub,name,created_at,last_login,stones) VALUES(?,?,?, ?,?,-1)").bind(id,'negative-'+id,'Review '+id,now(),now())));}
 const auditFirst=await walletAnomalies(db,await loadSettings(db),1),auditNext=await walletAnomalies(db,await loadSettings(db),2);assert.equal(auditFirst.rows.length,100);assert(auditFirst.more);assert(auditNext.rows.length>0);assert(!auditNext.rows.some(r=>auditFirst.rows.some(a=>a.id===r.id)));assert.equal(auditNext.page,2);
 await saveSettings(db,{proxycheck_key:'audit-private-proxy-key',resend_key:'audit-private-mail-key'});
 for(const path of ['/','/track/story','/api/me','/api/shop','/api/comments?track=1','/api/suggest?q=story']){const r=await call(path,{method:'GET',auth:''});const raw=typeof r.data==='string'?r.data:JSON.stringify(r.data);for(const value of [secret,us,'audit-private-proxy-key','audit-private-mail-key'])assert(!raw.includes(value),'no private configuration leak '+path);}
 await Promise.all(tasks);
 console.log('PASS: no unpaid permanent-item interleaving; full rollback of item/VIP/withdraw/refund/EXP on injected database failures; refund once; concurrent EXP awards grant level-up once with accurate balances; no free first time report; zero daily limits; strict stars and monetary bounds; private wallet ownership; no draft comment leaks; anomaly signals/exemptions and admin-only access; verified Google email linking and old-session invalidation; simultaneous email/Google signups cannot exceed the IP account limit.');
 console.log('PASS: fresh/idempotent migration; malformed cookies/JSON; actual and chunked payload limits; signed/expired/revoked/locked sessions; CSRF; admin/editor/demo permissions; drafts; SQL injection; concurrent ratings/hearts/checkin/quests/shop/withdraw; listen elapsed cap; ownership and nonnegative balances.');
}finally{await mf.dispose();}
