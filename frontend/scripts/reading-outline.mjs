/** Verify PDF destinations against extracted text before trusting the outline. */
export function groupPdfPages(items, bookmarks) {
 const norm=s=>String(s||'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 const warning='Chapter boundaries could not be verified. Reading units follow source order; review the source before publishing.';
 if(bookmarks.length<2||bookmarks.some((b,i)=>!Number.isInteger(b.page)||b.page<1||(i&&b.page<=bookmarks[i-1].page)))return {items,warnings:[warning]};
 for(const b of bookmarks){
  const page=items.find(i=>i.page===b.page),title=norm(b.title.replace(/^\d+[.)]\s*/,''));
  if(!title||!page||!norm(page.text).includes(title))return {items,warnings:[warning]};
 }
 let index=-1;
 return {items:items.map(item=>{
  while(index+1<bookmarks.length&&bookmarks[index+1].page<=item.page)index++;
  return {...item,chapter:index>=0?bookmarks[index].title:'Before you begin'};
 }),warnings:[]};
}
