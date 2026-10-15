// Local D1 regression checks; no production website or Shopee requests.
import assert from 'node:assert/strict';
const {Miniflare,convertV4MiniflareOptions}=await import(process.env.MINIFLARE_MODULE || 'miniflare');
import {migrate,saveSettings} from '../src/db.js';
import {onRequest} from '../functions/[[path]].js';
import {adReport,adReportDay} from '../src/ad-stats.js';
import {signToken,now,vnDay} from '../src/util.js';
import {ADMIN} from '../src/security.js';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("OK")}}',compatibilityDate:'2026-10-11',d1Databases:{DB:'ad-stats-regression'}}));
const db=await mf.getD1Database('DB'),origin='https://ad-stats-test.invalid',tasks=[];
const originalNow=Date.now;let clock=Date.UTC(2026,9,12,17);Date.now=()=>clock;
async function send(path,{method='GET',body,cookie=''}={}) {
 return onRequest({request:new Request(origin+path,{method,headers:{Origin:origin,'CF-Connecting-IP':'192.0.2.1',...(cookie?{Cookie:cookie}:{}),...(body instanceof FormData?{}:{'Content-Type':'application/json'})},...(method==='GET'?{}:{body:body instanceof FormData?body:JSON.stringify(body)})}),env:{DB:db},waitUntil:p=>tasks.push(p.catch(()=>{}))});
}
async function event(id,ev,extra={}){const r=await send('/api/stat',{method:'POST',body:{id,ev,...extra}});assert.equal(r.status,200);assert((await r.json()).ok);}
async function row(id,day){return db.prepare('SELECT shows, clicks FROM ad_stats_daily WHERE ad_id=? AND day=?').bind(id,day).first();}
try {
 await migrate(db);const started=(await db.prepare("SELECT v FROM settings WHERE k='ad_stats_started_at'").first()).v;await migrate(db);assert.equal((await db.prepare("SELECT v FROM settings WHERE k='ad_stats_started_at'").first()).v,started);
 await saveSettings(db,{admin_user:'audit-admin',secret:'local-admin-test-key',user_secret:'local-user-test-key',tz_offset:'7'});
 await db.prepare("INSERT INTO ads(id,title,url,shows,clicks) VALUES(1,'Product','https://s.shopee.vn/test',122,83)").run();await db.prepare("INSERT INTO ads(id,title,url) VALUES(2,'Other product','https://s.shopee.vn/other')").run();
 const early=await adReport(db,null);assert.equal(early.period.day,'2026-10-12');assert.equal(early.period.available,false);assert.equal(early.ads[0].clicks,0);assert.equal(early.ads.find(a=>a.id===1).clicks,83,'legacy lifetime clicks retained');assert.equal((await db.prepare('SELECT COUNT(*) n FROM ad_stats_daily').first()).n,0,'no invented historic daily counts');
 clock=Date.UTC(2026,9,13,5);assert.equal(vnDay(),'2026-10-13');for(let i=0;i<3;i++)await event(1,'show');for(let i=0;i<2;i++)await event(1,'click');await event(2,'show');await event(2,'click');
 assert.deepEqual(await row(1,'2026-10-13'),{shows:3,clicks:2});assert.deepEqual(await row(2,'2026-10-13'),{shows:1,clicks:1});
 clock=Date.UTC(2026,9,13,16,59,59);await event(1,'click');clock+=1000;assert.equal(vnDay(),'2026-10-14');await event(1,'show');await event(1,'click');
 const report=await adReport(db,null);assert.equal(report.period.day,'2026-10-13','Oct 14 defaults to Oct 13');assert.equal(report.period.available,true);assert.equal(report.ads.find(a=>a.id===1).day_clicks,3);assert.equal((await adReport(db,'2026-10-14')).ads.find(a=>a.id===1).day_clicks,1);assert.equal(report.ads.find(a=>a.id===1).clicks,87);
 await Promise.all(Array.from({length:12},()=>event(1,'click')));assert.equal((await row(1,'2026-10-14')).clicks,13);assert.equal((await row(1,'2026-10-13')).clicks,3);await event(1,'click',{day:'2000-01-01',at:0});assert.equal((await row(1,'2026-10-14')).clicks,14);assert.equal(await row(1,'2000-01-01'),null,'client cannot choose recording date');
 await event(999999,'click');assert.equal(await row(999999,'2026-10-14'),null,'no orphan stats');assert.equal((await send('/api/stat',{method:'POST',body:{id:1,ev:'other'}})).status,400);
 const before=await db.prepare('SELECT clicks FROM ads WHERE id=1').first();await db.prepare("CREATE TRIGGER fail_daily BEFORE INSERT ON ad_stats_daily WHEN NEW.ad_id=1 BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
 const error=console.error;console.error=()=>{};let failure;try{failure=await send('/api/stat',{method:'POST',body:{id:1,ev:'click'}});}finally{console.error=error;}assert.equal(failure.status,500);assert.equal((await db.prepare('SELECT clicks FROM ads WHERE id=1').first()).clicks,before.clicks,'lifetime increment rolls back when daily write fails');assert.equal((await row(1,'2026-10-14')).clicks,14);await db.prepare('DROP TRIGGER fail_daily').run();
 for(const value of ['2026-02-30','2026-10-15',"' OR 1=1",'x','2026-1-1',null])assert.equal(adReportDay(value),'2026-10-13');assert.equal(adReportDay('2024-02-29'),'2024-02-29');assert.equal(adReportDay('all'),'all');
 await db.prepare("INSERT INTO users(id,sub,name,role,created_at,last_login) VALUES(2,'editor-test','Editor','editor',?,?)").bind(now(),now()).run();
 const admin='aw_admin='+encodeURIComponent(await signToken('local-admin-test-key',{u:'audit-admin',exp:now()+86400})),editor='aw_user='+encodeURIComponent(await signToken('local-user-test-key',{uid:2,v:0,exp:now()+86400}));
 for(const [path,cookie] of [[ADMIN+'/qc',admin],['/bien-tap/qc',editor]]){
  const r=await send(path,{cookie});assert.equal(r.status,200);const html=await r.text();assert(html.includes('data-report-day="2026-10-13"'));assert(html.includes('Ngày 13/10/2026'));assert(/class="tnum ad-clicks"[^>]*>3<small>/.test(html));assert.equal(r.headers.get('Cache-Control'),'no-store');
  const today=await (await send(path+'?day=2026-10-14',{cookie})).text();assert(today.includes('data-report-day="2026-10-14"'));assert(/class="tnum ad-clicks"[^>]*>14<small>/.test(today));
  const all=await (await send(path+'?day=all',{cookie})).text();assert(all.includes('data-report-day="all"'));assert(/class="tnum ad-clicks"[^>]*>100<small>/.test(all));
  const past=await (await send(path+'?day=2026-10-12',{cookie})).text();assert(/class="tnum ad-clicks"[^>]*>—<small>/.test(past));assert(past.includes('chưa có dữ liệu tách riêng'));
 }
 assert.equal((await send(ADMIN+'/qc')).status,303);assert.equal((await send('/bien-tap/qc')).status,404);
 const form=new FormData();form.append('action','delete');form.append('id','2');const denied=await send('/bien-tap/qc?day=2026-10-13',{method:'POST',cookie:editor,body:form});assert.equal(denied.status,303);assert(await db.prepare('SELECT id FROM ads WHERE id=2').first());
 const deleted=await send(ADMIN+'/qc?day=2026-10-13',{method:'POST',cookie:admin,body:form});assert.equal(deleted.status,303);assert.equal(deleted.headers.get('Location'),ADMIN+'/qc?day=2026-10-13');assert.equal(await db.prepare('SELECT id FROM ads WHERE id=2').first(),null);assert.equal(await row(2,'2026-10-13'),null,'deleted ad daily rows cascade');
 await Promise.all(tasks);console.log('PASS: legacy totals retained without invented history; server-side UTC+7 day buckets and midnight rollover; Oct 14 defaults to Oct 13; today/custom/all filters; parallel events; transactional rollback; ignored client date and unknown IDs; admin/editor read permissions, editor writes denied, selected date retained and delete cascade.');
}finally{Date.now=originalNow;await mf.dispose();}
