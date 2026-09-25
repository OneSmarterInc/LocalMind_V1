/** Cover the start, middle and end; retain earlier checkpoint order on upgrades. */
export function quizSectionIndices(total:number,questions:number,legacy=false){
 const count=Math.min(total,questions);
 return Array.from({length:count},(_,i)=>legacy?i:count===1?Math.floor(total/2):Math.round(i*(total-1)/(count-1)));
}
