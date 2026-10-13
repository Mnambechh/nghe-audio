// Temporary local D1 only; no requests to Google or the production website.
import assert from 'node:assert/strict';
const {Miniflare,convertV4MiniflareOptions}=await import(process.env.MINIFLARE_MODULE || 'miniflare');
import {migrate,saveSettings} from '../src/db.js';
import {onRequest} from '../functions/[[path]].js';
import {blockIp,ADMIN} from '../src/security.js';
const origin='https://sitemap-test.invalid';
async function request(path,{method='GET',db,ip='192.0.2.50',ua='Test browser'}={}) {
  return onRequest({request:new Request(origin+path,{method,headers:{'CF-Connecting-IP':ip,'User-Agent':ua}}),env:db?{DB:db}:{},waitUntil:p=>p.catch(()=>{})});
}
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("OK")}}',compatibilityDate:'2026-10-11',d1Databases:{DB:'sitemap-regression'}}));
try {
  const robotsWithoutDb=await request('/robots.txt');assert.equal(robotsWithoutDb.status,200);assert((await robotsWithoutDb.text()).includes('Sitemap: '+origin+'/sitemap.xml'));
  const missing=await request('/sitemap.xml');assert.equal(missing.status,503);assert.equal(missing.headers.get('Retry-After'),'300');assert.equal(missing.headers.get('Cache-Control'),'no-store');assert(!(await missing.text()).includes('<html'));
  for(const path of ['/robots.txt','/sitemap.xml'])for(const method of ['POST','PUT','DELETE','OPTIONS'])assert.equal((await request(path,{method})).status,405);
  const db=await mf.getD1Database('DB');await migrate(db);await saveSettings(db,{admin_user:'test-admin',secret:'private-test-only-secret'});
  const seconds=Math.floor(Date.now()/1000),date=new Date(seconds*1000).toISOString().slice(0,10);
  const stamps=[seconds,seconds*1000,new Date(seconds*1000).toISOString(),'invalid-date','2026-99-99',0,-1,seconds+86400,'Infinity'];
  for(let i=0;i<stamps.length;i++)await db.prepare('INSERT INTO tracks(title,slug,published,created_at,updated_at) VALUES(?,?,1,?,?)').bind('Story '+i,'story-'+i,seconds,stamps[i]).run();
  for(const [slug,published] of [['private-draft',0],['bad slug',1],['bad&slug',1]])await db.prepare('INSERT INTO tracks(title,slug,published,created_at,updated_at) VALUES(?,?,?,?,?)').bind('Other',slug,published,seconds,seconds).run();
  await db.prepare('INSERT INTO pages(title,slug,content) VALUES(?,?,?)').bind('Public page','public-page','<p>Public content</p>').run();
  await db.prepare('INSERT INTO pages(title,slug,content) VALUES(?,?,?)').bind('Invalid route','bad page','Test').run();
  const normal=await request('/sitemap.xml',{db});assert.equal(normal.status,200);const xml=await normal.text();assert.equal(normal.headers.get('Content-Type'),'application/xml; charset=utf-8');assert.equal(normal.headers.get('Cache-Control'),'public, max-age=300');assert.equal(normal.headers.get('X-Robots-Tag'),null);assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));assert(xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'));assert(!xml.includes('private-test-only-secret'));
  for(let i=0;i<stamps.length;i++){const entry=xml.match(new RegExp('<url><loc>'+origin+'/track/story-'+i+'</loc>(.*?)</url>'))[1];if(i<3)assert.equal(entry,'<lastmod>'+date+'</lastmod>');else assert.equal(entry,'','omit invalid/future date but keep valid published URL');}
  for(const bad of ['private-draft','bad slug','bad&amp;slug','bad page','/api/','/tai-khoan','/lich-su-thuong',ADMIN])assert(!xml.includes(bad),'exclude '+bad);
  for(const good of [origin+'/',origin+'/ngon-tinh',origin+'/dam-my',origin+'/trang/public-page'])assert(xml.includes('<loc>'+good+'</loc>'));
  for(let i=0;i<stamps.length;i++){const page=await request('/track/story-'+i,{db});assert.equal(page.status,200,'published page survives imported update time '+i);const body=await page.text();assert(!body.includes('Invalid Date'));assert(!body.includes('NaN'));}
  await db.prepare('UPDATE tracks SET created_at=? WHERE slug=?').bind('invalid-date','story-3').run();assert.equal((await request('/track/story-3',{db})).status,200,'bad creation date does not break published page');
  const robots=await request('/robots.txt',{db});assert((await robots.text()).includes('Disallow: /api/'));
  await blockIp(db,'192.0.2.60','Regression test only',1);
  for(const ua of ['Googlebot','Ordinary browser'])for(const path of ['/robots.txt','/sitemap.xml']){
    const r=await request(path,{db,ip:'192.0.2.60',ua});assert.equal(r.status,200,'public discovery endpoint remains readable');assert.equal(r.headers.get('Content-Security-Policy'),null);assert.equal(r.headers.get('Set-Cookie'),null);
    const head=await request(path,{db,ip:'192.0.2.60',ua,method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('Content-Type'),r.headers.get('Content-Type'));
  }
  for(const path of ['/api/me','/api/withdraw','/api/wallet',ADMIN,'/track/story-0','/sitemap.xml/private'])assert.equal((await request(path,{db,ip:'192.0.2.60',ua:'Googlebot'})).status,403,'other routes still enforce blocked IP');
  assert.equal((await request('/sitemap.xml',{db,ip:'192.0.2.60',method:'POST'})).status,405);
  const emptyDbCheck=await request('/robots.txt',{method:'HEAD'});assert.equal(emptyDbCheck.status,200);assert.equal(await emptyDbCheck.text(),'');
  console.log('PASS: robots without D1; sitemap 503/retry when D1 missing; public GET/HEAD discovery independent of IP block; non-read methods denied; private/API IP blocks retained; XML content type, namespace, no private settings; timestamp seconds/ms/ISO and invalid/future values; published routable URLs only.');
} finally {await mf.dispose();}
