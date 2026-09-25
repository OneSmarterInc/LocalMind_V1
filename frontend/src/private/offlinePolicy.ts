/** Never turn an authorization failure or cancellation into local permission. */
export function offlineFallbackAllowed(status:number,code:string):boolean {
 return (status===0 && code==='NETWORK') || [502,503,504].includes(status);
}
