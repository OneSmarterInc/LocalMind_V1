import React from 'react';
import {Screen,PageHeading,P} from '@/ui';
import {GenerationJobs} from '@/private/GenerationJobs';
export default function JobsPage(){return <Screen><PageHeading title="Generation jobs" subtitle="Continue studying while your local AI works."/><P>Start lessons, quizzes or doubts from a private book. Their progress appears here.</P><GenerationJobs/></Screen>;}
