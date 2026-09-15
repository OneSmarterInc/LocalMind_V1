import React from 'react';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {api} from '@/api/client';
import {useAsync} from '@/hooks/useAsync';
import {Screen, PageHeading, Card, P, H2, Button, ErrorBanner, Loading} from '@/ui';
type Report={title:string;report:{status?:string;total?:number;assigned?:number;unassigned?:{id:string;caption:string;page?:number;reason:string}[];warnings?:string[]}};
export default function PictureReport(){
 const {id}=useLocalSearchParams<{id:string}>(),router=useRouter();
 const q=useAsync(()=>api<Report>(`/faculty/documents/${id}/visuals/`),[id]);
 const report=q.data?.report;
 return <Screen><PageHeading title="Source picture report" subtitle={q.data?.title} right={<Button title="Back to book" variant="secondary" onPress={()=>router.push(`/manage/document/${id}`)}/>}/>
  <ErrorBanner message={q.error} onRetry={q.reload}/>{q.loading&&!q.data?<Loading/>:null}
  {report&&<><Card><H2>Extraction and placement</H2><P>{report.total ?? 0} source visuals detected; {report.assigned ?? 0} assigned to modules.</P>
   <P muted>Pictures are matched by source page, authored headings and nearby text. Ambiguous pictures stay unassigned; they are not inserted into an unrelated lesson.</P>
   {!report.status?<P>This book has not had its source pictures refreshed with the new extractor.</P>:null}
   {(report.warnings || []).map((w,i)=><P key={i}>{w}</P>)}</Card>
   <Card><H2>Pictures needing review</H2>{!report.unassigned?.length?<P>No unassigned pictures in this extraction.</P>:report.unassigned.map(v=><P key={v.id}>{v.caption}{v.page?` · page ${v.page}`:''} — {v.reason.replace(/_/g,' ')}</P>)}</Card></>}
 </Screen>;
}
