import React from 'react';
import {View} from 'react-native';
import {H2,P} from '@/ui';
import {SourceFigures,type Figure} from '@/ui/SourceFigures';
import type {Lesson} from './core';
import {figurePlacement} from './figurePlacement';
export function LocalLessonView({lesson,visuals=[]}:{lesson:Lesson;visuals?:Figure[]}){
 const placement=figurePlacement(lesson.sections,visuals);
 return <View style={{gap:16}}><P>{lesson.introduction}</P>{lesson.sections.map((s,i)=><View key={i} style={{gap:8}}><H2>{s.heading}</H2><P>{s.content}</P><SourceFigures visuals={placement.groups[i]}/><P small muted>From the book: {s.quote}</P></View>)}{placement.remaining.length?<><H2>Figures from this module</H2><SourceFigures visuals={placement.remaining}/></>:null}<H2>Key takeaways</H2>{lesson.takeaways.map((t,i)=><P key={i}>• {t}</P>)}</View>;
}
