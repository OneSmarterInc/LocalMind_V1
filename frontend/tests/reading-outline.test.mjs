import test from 'node:test';
import assert from 'node:assert/strict';
import {groupPdfPages} from '../scripts/reading-outline.mjs';
const pages=[{title:'Page 1',page:1,text:'First chapter\nFirst body',visualIds:['v1']},{title:'Page 2',page:2,text:'Continuation',visualIds:['v2']},{title:'Page 3',page:3,text:'Second chapter\nSecond body',visualIds:['v3']}];
test('verified chapter destinations group consecutive pages without changing source or imagery',()=>{
 const grouped=groupPdfPages(pages,[{title:'1. First chapter',page:1},{title:'2. Second chapter',page:3}]);
 assert.deepEqual(grouped.items.map(p=>p.chapter),['1. First chapter','1. First chapter','2. Second chapter']);
 assert.deepEqual(grouped.items.map(p=>p.text),pages.map(p=>p.text));
 assert.deepEqual(grouped.items.map(p=>p.visualIds),pages.map(p=>p.visualIds));assert.equal(grouped.warnings.length,0);
});
for(const bookmarks of [[],[{title:'Wrong',page:1},{title:'Second chapter',page:3}],[{title:'First chapter',page:1},{title:'Second chapter',page:1}]]){
 test(`ambiguous destinations warn without discarding source: ${JSON.stringify(bookmarks)}`,()=>{
  const grouped=groupPdfPages(pages,bookmarks);assert.deepEqual(grouped.items,pages);assert.equal(grouped.warnings.length,1);
 });
}
