import React from 'react';
import { useAuth } from '@/auth/AuthContext';
import Page from '@/private/screens/OfflineAI';
export default function ScopedPrivatePage() { const {user}=useAuth(); return user ? <Page key={user.id} /> : null; }
